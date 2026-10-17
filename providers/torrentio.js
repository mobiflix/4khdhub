'use strict';

const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TORRENTIO_API = 'https://torrentio.strem.fun';
const PROVIDER_NAME = 'Torrentio';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json'
};
const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce'
];

function getDebridSettings() {
  let provider = 'none';
  let key = '';
  try {
    let settings = null;
    if (typeof global !== 'undefined' && global.SCRAPER_SETTINGS) {
      settings = global.SCRAPER_SETTINGS;
    } else if (typeof window !== 'undefined' && window.SCRAPER_SETTINGS) {
      settings = window.SCRAPER_SETTINGS;
    }
    if (settings) {
      if (settings.debridProvider) {
        provider = String(settings.debridProvider).toLowerCase().trim();
      }
      if (settings.debridKey) {
        key = String(settings.debridKey).trim();
      }
    }
  } catch (e) {
    console.error('[Torrentio] Error reading settings context:', e);
  }
  return { provider, key };
}

function buildMagnet(infoHash) {
  if (!infoHash) return '';
  const trackerParams = TRACKERS.map(t => '&tr=' + encodeURIComponent(t)).join('');
  return 'magnet:?xt=urn:btih:' + infoHash + trackerParams;
}

function getDebridPathSegment() {
  const { provider, key } = getDebridSettings();
  if (!provider || provider === 'none' || !key) return '';
  return provider + '=' + key;
}

async function getStreams(id, type = 'movie', season = null, episode = null) {
  const isSeries = type === 'tv' || type === 'series';
  const tmdbUrl = 'https://api.themoviedb.org/3/' + (isSeries ? 'tv' : 'movie') + '/' + id + '?api_key=' + TMDB_API_KEY + '&append_to_response=external_ids';

  try {
    const meta = await fetch(tmdbUrl).then(r => r.json()).catch(() => null);
    const imdbId = meta?.external_ids?.imdb_id || meta?.imdb_id || id;
    const title = meta?.title || meta?.name || 'Unknown Title';
    const year = meta?.release_date ? meta.release_date.split('-')[0] : (meta?.first_air_date ? meta.first_air_date.split('-')[0] : 'N/A');

    const debridSegment = getDebridPathSegment();
    const debridPrefix = debridSegment ? debridSegment + '/' : '';
    const streamId = isSeries
      ? 'series/' + imdbId + ':' + (season || 1) + ':' + (episode || 1)
      : 'movie/' + imdbId;

    const streamUrl = TORRENTIO_API + '/' + debridPrefix + 'stream/' + streamId + '.json';
    const data = await fetch(streamUrl, { headers: HEADERS }).then(r => r.json()).catch(() => null);

    if (!data?.streams || data.streams.length === 0) return [];

    const results = [];

    data.streams.slice(0, 15).map(stream => {
      if (!stream) return;

      const rawDesc = (stream.description || '').replace(/\n/g, ' ');
      const normalized = rawDesc.toUpperCase();

      // ✅ 1080p FILTER — skip lahat ng hindi 1080p
      if (!normalized.includes('1080P')) return;

      const seeders = rawDesc.match(/👤\s*(\d+)/)?.[1] || '0';

      let size = 'Unknown';
      const sizeMatch = rawDesc.match(/([0-9.]+ ?[GM]B)/i);
      if (sizeMatch) size = sizeMatch[1].toUpperCase();

      // Fixed 1080p quality
      let quality = '1080p';
      let qualityIcon = '💎';

      let audio = 'Unknown';
      if (normalized.includes('DUAL') || normalized.includes('DUAL-AUDIO')) {
        audio = 'Dual-Audio';
      } else if (normalized.includes('MULTI') || normalized.includes('MULTI-AUDIO') || normalized.includes('MULTI-SUB')) {
        audio = 'Multi-Audio';
      } else if (normalized.includes('SUB')) {
        audio = 'Subbed';
      }

      const tags = [];
      if (normalized.includes('DV') || normalized.includes('DOLBYVISION')) tags.push('DV');
      if (normalized.includes('HDR10+')) tags.push('HDR10+');
      else if (normalized.includes('HDR10')) tags.push('HDR10');
      else if (normalized.includes('HDR')) tags.push('HDR');
      if (normalized.includes('HEVC') || normalized.includes('X265') || normalized.includes('H.265')) tags.push('HEVC');
      tags.push(audio);
      const tagString = tags.join(' • ');

      let providerName = PROVIDER_NAME;
      const providerMatch = rawDesc.match(/\[(.*?)\]/);
      if (providerMatch && providerMatch[1]) {
        const candidate = providerMatch[1].trim();
        if (!/\d+P|HEVC|H264|WEB|BLURAY/i.test(candidate)) {
          providerName = candidate;
        }
      }
      if (providerName === PROVIDER_NAME) {
        if (normalized.includes('RARBG')) providerName = 'RARBG';
        else if (normalized.includes('YTS')) providerName = 'YTS';
        else if (normalized.includes('YIFY') || normalized.includes('TPB')) providerName = 'ThePirateBay';
        else if (normalized.includes('1337X')) providerName = '1337x';
        else if (normalized.includes('EZTV')) providerName = 'EZTV';
        else if (normalized.includes('TGX')) providerName = 'TGX';
      }

      const url = stream.url || (stream.infoHash ? buildMagnet(stream.infoHash) : '');
      const titleLine = isSeries
        ? '📺 ' + title + ' | S' + (season || 1) + ' E' + (episode || 1)
        : '🎬 ' + title + ' - ' + year;
      const qualityLine = qualityIcon + ' ' + quality + ' | ' + tagString;
      const infoLine = '👤 ' + seeders + ' | 💾 ' + size + ' | ' + providerName;
      const fullTitle = titleLine + '\n' + qualityLine + '\n' + infoLine;

      results.push({
        name: PROVIDER_NAME + ' | 👤' + seeders + ' | ' + quality.toUpperCase(),
        title: fullTitle,
        size: fullTitle,
        description: fullTitle,
        url: url
      });
    });

    return results;
  } catch (e) {
    console.error('[Torrentio] Error:', e);
    return [];
  }
}

async function onSettings() {
  return [
    { type: 'header', label: 'Debrid Provider Configuration' },
    {
      type: 'select',
      key: 'debridProvider',
      label: 'Debrid Provider',
      options: [
        { label: 'None', value: 'none' },
        { label: 'Real-Debrid', value: 'realdebrid' },
        { label: 'Premiumize', value: 'premiumize' },
        { label: 'AllDebrid', value: 'alldebrid' },
        { label: 'DebridLink', value: 'debridlink' },
        { label: 'EasyDebrid', value: 'easydebrid' },
        { label: 'Offcloud', value: 'offcloud' },
        { label: 'TorBox', value: 'torbox' },
        { label: 'Put.io', value: 'putio' }
      ],
      default: 'none'
    },
    {
      type: 'password',
      isPassword: true,
      key: 'debridKey',
      label: 'API Key / Token',
      placeholder: 'Enter your Debrid API key',
      description: 'API Key or Access Token for your selected Debrid service.'
    }
  ];
}

module.exports = { getStreams, onSettings };