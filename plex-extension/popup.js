const modeEl = document.getElementById('mode');
const customRowEl = document.getElementById('customRow');
const customDateEl = document.getElementById('customDate');
const statusEl = document.getElementById('status');
const applyEl = document.getElementById('apply');
const serverBaseEl = document.getElementById('serverBase');
const plexTokenEl = document.getElementById('plexToken');
const saveSettingsEl = document.getElementById('saveSettings');

init().catch((err) => setStatus(`Error: ${err.message}`));

modeEl.addEventListener('change', () => {
  customRowEl.style.display = modeEl.value === 'custom' ? 'block' : 'none';
});

saveSettingsEl.addEventListener('click', async () => {
  try {
    const settings = normalizeSettings({
      serverBase: serverBaseEl.value,
      plexToken: plexTokenEl.value
    });
    await chrome.storage.local.set(settings);
    setStatus('Settings saved.');
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
});

applyEl.addEventListener('click', async () => {
  setStatus('Working...');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !tab.url) throw new Error('No active tab found.');

    const settings = normalizeSettings(await chrome.storage.local.get(['serverBase', 'plexToken']));

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const readStorage = (storage) => {
          const out = {};
          try {
            for (let i = 0; i < storage.length; i += 1) {
              const key = storage.key(i);
              out[key] = storage.getItem(key);
            }
          } catch (_) {}
          return out;
        };

        function extractMetadataId() {
          const candidates = new Set();
          const href = window.location.href;
          const decoded = decodeURIComponent(href);
          const scripts = Array.from(document.scripts).map((s) => s.textContent || '');
          const bodyText = document.body?.innerHTML?.slice(0, 200000) || '';

          const patterns = [
            /\/library\/metadata\/(\d+)/gi,
            /metadata%2F(\d+)/gi,
            /key=%2Flibrary%2Fmetadata%2F(\d+)/gi,
            /key=\/library\/metadata\/(\d+)/gi,
            /"ratingKey"\s*[:=]\s*"?(\d+)"?/gi,
            /ratingKey=(\d+)/gi,
            /\/preplay\/metadata\/(\d+)/gi,
            /metadata_id["'=:\s]+(\d+)/gi
          ];

          for (const source of [href, decoded, ...scripts, bodyText]) {
            for (const pattern of patterns) {
              pattern.lastIndex = 0;
              let match;
              while ((match = pattern.exec(source)) !== null) {
                if (match[1]) candidates.add(match[1]);
              }
            }
          }

          const canonical = document.querySelector('link[rel="canonical"]')?.href || '';
          const cMatch = canonical.match(/\/library\/metadata\/(\d+)/);
          if (cMatch) candidates.add(cMatch[1]);

          return Array.from(candidates)[0] || null;
        }

        function extractToken() {
          const sources = [readStorage(localStorage), readStorage(sessionStorage)];
          for (const source of sources) {
            for (const [key, value] of Object.entries(source)) {
              if (!value) continue;
              if (/token/i.test(key) && typeof value === 'string') {
                if (/^[A-Za-z0-9._-]{16,}$/.test(value)) return value;
                try {
                  const parsed = JSON.parse(value);
                  if (parsed?.authToken) return parsed.authToken;
                  if (parsed?.token) return parsed.token;
                } catch (_) {}
              }
              if (typeof value === 'string' && value.includes('authToken')) {
                try {
                  const parsed = JSON.parse(value);
                  if (parsed?.authToken) return parsed.authToken;
                } catch (_) {}
              }
            }
          }
          return null;
        }

        return {
          href: window.location.href,
          origin: window.location.origin,
          title: document.title,
          metadataId: extractMetadataId(),
          autoToken: extractToken(),
          isHostedApp: /(^|\.)plex\.tv$/i.test(window.location.hostname)
        };
      }
    });

    if (!result?.metadataId) {
      throw new Error('Could not detect the Plex metadata ID from the current page.');
    }

    const metadataId = result.metadataId;
    const targetDate = resolveTargetDate();
    const unixTs = Math.floor(targetDate.getTime() / 1000);

    const serverBase = pickServerBase({ pageOrigin: result.origin, savedServerBase: settings.serverBase });
    const plexToken = result.autoToken || settings.plexToken;

    if (!serverBase) {
      throw new Error('No Plex server base URL available. Save it under Server settings.');
    }
    if (!plexToken) {
      throw new Error('No Plex token available. Save it under Server settings.');
    }

    const metadataUrl = `${serverBase}/library/metadata/${encodeURIComponent(metadataId)}?X-Plex-Token=${encodeURIComponent(plexToken)}`;
    const metadataRes = await fetch(metadataUrl, {
      method: 'GET',
      credentials: 'omit',
      headers: {
        'Accept': 'application/xml'
      }
    });

    if (!metadataRes.ok) {
      throw new Error(`Metadata lookup failed: HTTP ${metadataRes.status}\nURL: ${metadataUrl}`);
    }

    const xmlText = await metadataRes.text();
    const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
    const mediaNode = xml.querySelector('Video, Directory, Track, Photo');

    if (!mediaNode) {
      const apiError = xml.querySelector('MediaContainer')?.getAttribute('message');
      throw new Error(apiError || 'Could not parse Plex metadata response.');
    }

    const sectionId = mediaNode.getAttribute('librarySectionID');
    const type = mediaNode.getAttribute('type');
    const mappedType = mapType(type);

    if (!sectionId || !mappedType) {
      throw new Error(`Missing sectionId or unsupported type. type=${type || 'unknown'}`);
    }

    const putUrl = new URL(`${serverBase}/library/sections/${sectionId}/all`);
    putUrl.searchParams.set('type', mappedType);
    putUrl.searchParams.set('id', metadataId);
    putUrl.searchParams.set('addedAt.value', String(unixTs));
    putUrl.searchParams.set('X-Plex-Token', plexToken);

    const putRes = await fetch(putUrl.toString(), {
      method: 'PUT',
      credentials: 'omit'
    });

    if (!putRes.ok) {
      const body = await safeText(putRes);
      throw new Error(`Update failed: HTTP ${putRes.status}\nURL: ${putUrl}\n${body.slice(0, 300)}`);
    }

    setStatus(
      `Done.\nTitle: ${result.title}\nMetadata ID: ${metadataId}\nServer: ${serverBase}\nNew addedAt: ${targetDate.toISOString().slice(0, 10)}\n\nRefresh Plex if the row does not update immediately.`
    );
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
});

async function init() {
  const settings = await chrome.storage.local.get(['serverBase', 'plexToken']);
  if (settings.serverBase) serverBaseEl.value = settings.serverBase;
  if (settings.plexToken) plexTokenEl.value = settings.plexToken;
}

function resolveTargetDate() {
  const now = new Date();
  if (modeEl.value === 'custom') {
    if (!customDateEl.value) throw new Error('Choose a custom date first.');
    const d = new Date(`${customDateEl.value}T12:00:00`);
    if (Number.isNaN(d.getTime())) throw new Error('Invalid custom date.');
    return d;
  }
  const days = Number(modeEl.value);
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function mapType(type) {
  const map = {
    movie: '1',
    show: '2',
    season: '3',
    episode: '4',
    artist: '8',
    album: '9',
    track: '10',
    clip: '12',
    photo: '13',
    photoalbum: '14'
  };
  return map[type] || null;
}

function pickServerBase({ pageOrigin, savedServerBase }) {
  const isHostedApp = /^https:\/\/([a-z0-9-]+\.)*plex\.tv$/i.test(pageOrigin || '');
  if (!isHostedApp && pageOrigin && /^https?:\/\//i.test(pageOrigin)) {
    return pageOrigin.replace(/\/$/, '');
  }
  return (savedServerBase || '').replace(/\/$/, '');
}

function normalizeSettings(settings) {
  const out = {};
  if (typeof settings.serverBase === 'string') {
    out.serverBase = settings.serverBase.trim().replace(/\/$/, '');
  }
  if (typeof settings.plexToken === 'string') {
    out.plexToken = settings.plexToken.trim();
  }
  return out;
}

async function safeText(response) {
  try {
    return await response.text();
  } catch (_) {
    return '';
  }
}

function setStatus(msg) {
  statusEl.textContent = msg;
}
