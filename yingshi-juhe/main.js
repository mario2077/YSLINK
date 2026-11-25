const SOURCE_NAME = "影视聚合";
const siteBaseUrl = "https://hongguoduanju.com";
const suggestionUrl = siteBaseUrl + "/incent_resource/suggestion";
const suggestionAppId = "8662";
const cacheTTL = 6 * 60 * 60 * 1000;
const countTTL = 24 * 60 * 60 * 1000;
const playlistLimit = 6 * 1024 * 1024;
const maxSegmentScan = 60000;

const genres = [
  { key: "series", name: "连续剧" },
  { key: "variety", name: "综艺" },
  { key: "anime", name: "动漫" },
];

// 片源站（macCMS 采集接口），按画质与命中率排序
const libraries = [
  { id: "modu", name: "魔都影视", base: "https://caiji.moduapi.cc/api.php/provide/vod/" },
  { id: "wujin", name: "无尽影视", base: "https://api.wujinapi.com/api.php/provide/vod/" },
  { id: "zy360", name: "360影视", base: "https://360zy.com/api.php/provide/vod/" },
  { id: "bdzy", name: "百度影视", base: "https://api.apibdzy.com/api.php/provide/vod/" },
  { id: "guangsu", name: "光速影视", base: "https://api.guangsuapi.com/api.php/provide/vod/" },
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isEmptyRecord(value) {
  return !isRecord(value) || Object.keys(value).length === 0;
}

function stringOf(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = stringOf(value);
    if (text !== "") {
      return text;
    }
  }
  return "";
}

function intOf(value, fallback) {
  const parsed = parseInt(stringOf(value), 10);
  return isNaN(parsed) ? fallback : parsed;
}

function nested(value, ...keys) {
  let current = value;
  for (const key of keys) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function anyList(value) {
  return Array.isArray(value) ? value : [];
}

function parseJson(text) {
  const trimmed = (text || "").trim();
  if (trimmed === "") {
    throw new Error("站点返回了空响应");
  }
  try {
    return JSON.parse(host.preserveIntegers(trimmed));
  } catch (error) {
    throw new Error("站点返回的内容不是有效 JSON");
  }
}

function leadingJson(text, start) {
  const end = text.indexOf("</script>", start);
  if (end > start) {
    try {
      const value = parseJson(text.slice(start, end).replace(/[\s;]+$/, ""));
      return isRecord(value) ? value : null;
    } catch (error) {}
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (code === 92) {
        escaped = true;
      } else if (code === 34) {
        inString = false;
      }
      continue;
    }
    if (code === 34) {
      inString = true;
    } else if (code === 123 || code === 91) {
      depth++;
    } else if (code === 125 || code === 93) {
      depth--;
      if (depth === 0) {
        try {
          const value = parseJson(text.slice(start, index + 1));
          return isRecord(value) ? value : null;
        } catch (error) {
          return null;
        }
      }
    } else if (depth === 0 && code > 32) {
      return null;
    }
  }
  return null;
}

function parseRouterData(raw) {
  const match = /(?:window\.)?_ROUTER_DATA\s*=\s*/.exec(raw);
  return match ? leadingJson(raw, match.index + match[0].length) : null;
}

function routerLoaderMap(data, ...names) {
  const loader = nested(data, "loaderData");
  if (!isRecord(loader)) {
    return null;
  }
  for (const name of names) {
    if (!isEmptyRecord(loader[name])) {
      return loader[name];
    }
  }
  for (const key of Object.keys(loader)) {
    for (const name of names) {
      const prefix = name.replace(/\$$/, "");
      if (prefix !== "" && key.indexOf(prefix) === 0 && !isEmptyRecord(loader[key])) {
        return loader[key];
      }
    }
  }
  return null;
}

function fetchSiteText(address) {
  return host.fetchText({ url: address, referer: siteBaseUrl + "/" }).body;
}

function webPage(path) {
  const data = parseRouterData(fetchSiteText(siteBaseUrl + path));
  if (!data) {
    throw new Error("红果网页结构无法解析");
  }
  return data;
}

function coverOf(row) {
  const raw = firstNonEmpty(row.series_cover, row.cover, row.cover_url, row.pic);
  if (raw === "") {
    return "";
  }
  if (raw.indexOf("//") === 0) {
    return "https:" + raw;
  }
  if (raw.indexOf("http") === 0) {
    return raw;
  }
  return raw.indexOf("/") === 0 ? siteBaseUrl + raw : raw;
}

function tagsOf(row) {
  const tags = [];
  const push = (name) => {
    const text = stringOf(name);
    if (text !== "" && tags.indexOf(text) < 0) {
      tags.push(text);
    }
  };
  for (const item of anyList(row.tags)) {
    push(isRecord(item) ? firstNonEmpty(item.name, item.tag_name, item.title) : item);
  }
  for (const item of anyList(row.category_list)) {
    push(isRecord(item) ? firstNonEmpty(item.name, item.category_name) : item);
  }
  return tags;
}

function dramaFromRow(value) {
  if (!isRecord(value)) {
    return null;
  }
  const row = isEmptyRecord(value.video_data) ? value : value.video_data;
  const sourceId = firstNonEmpty(
    row.series_id_str,
    row.series_id,
    value.series_id_str,
    value.series_id,
    value.keyword,
  );
  if (!/^[0-9]{1,32}$/.test(sourceId)) {
    return null;
  }
  const title = firstNonEmpty(row.series_title, row.series_name, row.title, value.name, sourceId);
  const intro = firstNonEmpty(row.series_intro, row.video_desc, row.desc, value.series_intro);
  const count = intOf(firstNonEmpty(row.episode_cnt, value.episode_cnt), 0);
  let remark = firstNonEmpty(row.episode_right_text, value.episode_right_text);
  if (remark === "" && count > 0) {
    remark = "共" + count + "集";
  }
  const status = intOf(row.series_status, -1);
  const tags = tagsOf(row);
  const hot = nested(row, "hot_score_data");
  return {
    id: host.dramaId(sourceId),
    source: host.source,
    sourceId: sourceId,
    title: title,
    name: title,
    desc: intro,
    intro: intro,
    cover: coverOf(row),
    coverUrl: coverOf(row),
    categoryName: tags.length ? tags[0] : "红果",
    channelName: "红果",
    remark: remark,
    totalEpisode: count > 0 ? count : undefined,
    episodeCount: count > 0 ? count : undefined,
    tags: tags,
    releaseStatus: status === 1 ? "finished" : status === 0 ? "ongoing" : undefined,
    heat: firstNonEmpty(nested(hot, "text"), row.hot_score_text),
  };
}

function rememberCount(sourceId, count) {
  if (count > 0) {
    host.cacheSet("cnt-" + sourceId, String(count), countTTL);
  }
}

function cachedCount(sourceId) {
  const raw = host.cacheGet("cnt-" + sourceId);
  const parsed = intOf(raw, 0);
  if (parsed > 0) {
    return parsed;
  }
  try {
    const stored = intOf(host.loadState("count-" + sourceId), 0);
    if (stored > 0) {
      return stored;
    }
  } catch (error) {}
  return 0;
}

function episodeCount(sourceId) {
  const cached = cachedCount(sourceId);
  if (cached > 0) {
    return cached;
  }
  const data = webPage("/detail?series_id=" + encodeURIComponent(sourceId));
  const page = routerLoaderMap(data, "detail_page", "detail_");
  const detail = nested(page, "seriesDetail");
  const list = anyList(detail && detail.vid_list);
  const count = list.length || intOf(detail && detail.episode_cnt, 0);
  if (count > 0) {
    rememberCount(sourceId, count);
    try {
      host.saveState("count-" + sourceId, String(count));
    } catch (error) {}
  }
  return count;
}

function normalizeTitle(text) {
  return stringOf(text)
    .replace(/[\s\u3000]/g, "")
    .replace(/[《》「」『』【】\[\]（）()·,，.。:：;；!！?？'"“”‘’\-_/\\|~`@#$%^&*+=]/g, "")
    .replace(/第[0-9零〇一二两兩三四五六七八九十百]+[季部]$/u, "")
    .toLowerCase();
}

function similarity(name, wanted) {
  if (name === "" || wanted === "") {
    return 0;
  }
  if (name === wanted) {
    return 100;
  }
  const shorter = name.length <= wanted.length ? name : wanted;
  const longer = name.length <= wanted.length ? wanted : name;
  const ratio = shorter.length / longer.length;
  const prefix = longer.indexOf(shorter) === 0;
  const rest = prefix ? longer.slice(shorter.length) : "";
  // 前缀命中且剩余部分只是季/部/数字等修饰 → 视为同一部
  if (prefix && /^[0-9零〇一二两兩三四五六七八九十百千万第季部篇集之·]+$/u.test(rest)) {
    return 80;
  }
  // 长度差距过大说明不是同一部（避免「嫌疑人的秘密」误配「嫌疑人的秘密2藏金生死线」）
  if (ratio < 0.75) {
    return 0;
  }
  if (prefix) {
    return 60;
  }
  if (longer.indexOf(shorter) >= 0) {
    return 30;
  }
  return 0;
}

function librarySearch(library, title) {
  const address = library.base + "?ac=detail&wd=" + encodeURIComponent(title);
  const body = host.fetchText({ url: address, referer: library.base }).body;
  const data = parseJson(body);
  return anyList(data.list);
}

function splitPlayGroups(item) {
  const from = stringOf(item.vod_play_from).split("$$$");
  const urls = stringOf(item.vod_play_url).split("$$$");
  const groups = [];
  for (let index = 0; index < urls.length; index++) {
    const raw = stringOf(urls[index]);
    if (raw === "") {
      continue;
    }
    const entries = [];
    for (const part of raw.split("#")) {
      const text = part.trim();
      if (text === "") {
        continue;
      }
      const cut = text.indexOf("$");
      const label = cut >= 0 ? text.slice(0, cut) : "";
      const address = (cut >= 0 ? text.slice(cut + 1) : text).trim();
      if (address === "") {
        continue;
      }
      entries.push({ label: label, address: address });
    }
    if (!entries.length) {
      continue;
    }
    const playable = entries.some((entry) => entry.address.indexOf(".m3u8") >= 0);
    groups.push({ from: stringOf(from[index]), entries: entries, playable: playable });
  }
  return groups;
}

function pickGroup(item) {
  const groups = splitPlayGroups(item).filter((group) => group.playable);
  if (!groups.length) {
    return null;
  }
  // 优先取「全部分集都是 m3u8 直链」的那组
  let best = null;
  let bestScore = -1;
  for (const group of groups) {
    const direct = group.entries.filter((entry) => entry.address.indexOf(".m3u8") >= 0).length;
    const score = direct * 1000 + group.entries.length;
    if (score > bestScore) {
      best = group;
      bestScore = score;
    }
  }
  return best;
}

function searchQueries(title) {
  const queries = [];
  const push = (value) => {
    const text = stringOf(value);
    if (text !== "" && queries.indexOf(text) < 0) {
      queries.push(text);
    }
  };
  push(title);
  // 去掉季/部后缀
  push(title.replace(/第[0-9零〇一二两兩三四五六七八九十百]+[季部]$/u, ""));
  // 长标题按前缀逐级缩短，供片源站用短词命中
  const cleaned = stringOf(title).replace(/[\s\u3000]/g, "");
  for (let length = Math.min(cleaned.length - 1, 12); length >= 4; length -= 1) {
    push(cleaned.slice(0, length));
  }
  return queries;
}

function remarkCount(item) {
  const remark = stringOf(item.vod_remarks);
  const match = /([0-9]{1,4})\s*集/.exec(remark);
  if (!match) {
    return 0;
  }
  return intOf(match[1], 0);
}

function matchLibrary(title) {
  const wanted = normalizeTitle(title);
  if (wanted === "") {
    return null;
  }
  const queries = searchQueries(title);
  for (const library of libraries) {
    const seen = {};
    let best = null;
    let bestScore = -1;
    for (const query of queries) {
      let list;
      try {
        list = librarySearch(library, query);
      } catch (error) {
        continue;
      }
      for (const item of list) {
        const key = stringOf(item.vod_id) + "|" + stringOf(item.vod_name);
        if (seen[key]) {
          continue;
        }
        seen[key] = true;
        const group = pickGroup(item);
        if (!group) {
          continue;
        }
        const name = normalizeTitle(item.vod_name);
        const base = similarity(name, wanted);
        if (base === 0) {
          continue;
        }
        // 单条「全集」也能用（会做时间切片），多集更好
        const score = base + Math.min(group.entries.length, 50);
        if (score > bestScore) {
          best = { library: library, item: item, group: group, score: score };
          bestScore = score;
        }
      }
      if (best && bestScore >= 100) {
        return best;
      }
    }
    if (best) {
      return best;
    }
  }
  return null;
}

function absoluteOf(base, address) {
  if (/^https?:\/\//i.test(address)) {
    return address;
  }
  try {
    return host.resolveUrl(base, address);
  } catch (error) {
    return address;
  }
}

function parseSegments(playlist) {
  const lines = playlist.split(/\r?\n/);
  const segments = [];
  const extras = [];
  let duration = 0;
  let pending = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") {
      continue;
    }
    if (line.indexOf("#EXTINF:") === 0) {
      const value = parseFloat(line.slice(8).split(",")[0]);
      pending = isNaN(value) || value < 0 ? 0 : value;
      continue;
    }
    if (line.charAt(0) === "#") {
      if (
        line.indexOf("#EXT-X-MAP:") === 0 ||
        line.indexOf("#EXT-X-KEY:") === 0 ||
        line.indexOf("#EXT-X-BYTERANGE:") === 0
      ) {
        extras.push(line);
      }
      continue;
    }
    if (pending === null) {
      continue;
    }
    segments.push({ start: duration, duration: pending, address: line });
    duration += pending;
    pending = null;
    if (segments.length > maxSegmentScan) {
      break;
    }
  }
  return { segments: segments, extras: extras, duration: duration };
}

function pickMasterVariant(playlist, base) {
  const lines = playlist.split(/\r?\n/);
  let best = null;
  let bestBandwidth = -1;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (line.indexOf("#EXT-X-STREAM-INF:") !== 0) {
      continue;
    }
    const match = /BANDWIDTH=([0-9]+)/.exec(line);
    const bandwidth = match ? intOf(match[1], 0) : 0;
    let next = "";
    for (let cursor = index + 1; cursor < lines.length; cursor++) {
      const candidate = lines[cursor].trim();
      if (candidate === "" || candidate.charAt(0) === "#") {
        continue;
      }
      next = candidate;
      break;
    }
    if (next === "") {
      continue;
    }
    if (bandwidth > bestBandwidth) {
      bestBandwidth = bandwidth;
      best = next;
    }
  }
  if (!best) {
    return "";
  }
  return host.resolveUrl(base, best);
}

function loadPlaylist(address, referer) {
  let result = host.fetchPlaylist({ url: address, referer: referer });
  let playlist = result.playlist || "";
  let base = result.url || address;
  if (playlist.indexOf("#EXT-X-STREAM-INF:") >= 0) {
    const variant = pickMasterVariant(playlist, base);
    if (variant === "") {
      throw new Error("片源没有可用的清晰度");
    }
    result = host.fetchPlaylist({ url: variant, referer: referer });
    playlist = result.playlist || "";
    base = result.url || variant;
  }
  if (playlist.indexOf("#EXTINF:") < 0) {
    throw new Error("片源播放列表为空");
  }
  return { playlist: playlist, base: base, durationMs: intOf(result.durationMs, 0) };
}

function directoryOf(address) {
  const cut = address.indexOf("?");
  const clean = cut >= 0 ? address.slice(0, cut) : address;
  const slash = clean.lastIndexOf("/");
  if (slash <= 8) {
    return clean;
  }
  return clean.slice(0, slash + 1);
}

function slicePlaylist(loaded, index, total) {
  const parsed = parseSegments(loaded.playlist);
  if (!parsed.segments.length) {
    throw new Error("片源播放列表无法解析");
  }
  const span = total > 1 ? parsed.duration / total : parsed.duration;
  let from = span * (index - 1);
  let to = span * index;
  if (index <= 1) {
    from = 0;
  }
  if (total > 1 && index >= total) {
    to = parsed.duration;
  }
  const chosen = parsed.segments.filter((segment) => segment.start + segment.duration > from + 0.0001 && segment.start < to - 0.0001);
  if (!chosen.length) {
    throw new Error("这一集没有对应的片源片段");
  }
  let target = 0;
  let total2 = 0;
  for (const segment of chosen) {
    total2 += segment.duration;
    target = Math.max(target, Math.ceil(segment.duration));
  }
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-TARGETDURATION:" + Math.max(target, 1),
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:VOD",
  ];
  const seen = {};
  for (const extra of parsed.extras) {
    if (seen[extra]) {
      continue;
    }
    seen[extra] = true;
    lines.push(extra);
  }
  for (const segment of chosen) {
    lines.push("#EXTINF:" + segment.duration.toFixed(6) + ",");
    lines.push(absoluteOf(loaded.base, segment.address));
  }
  lines.push("#EXT-X-ENDLIST");
  return { playlist: lines.join("\n") + "\n", durationMs: Math.round(total2 * 1000) };
}

function directEpisode(entry) {
  return { url: entry.address, referer: "", mode: "direct" };
}

function resolveFromLibrary(match, index, total) {
  const group = match.group;
  const entries = group.entries;
  const referer = match.library.base;
  if (entries.length > 1 && total > 1) {
    if (index < 1 || index > entries.length) {
      throw new Error("这一集超出了片源的分集范围");
    }
    const entry = entries[index - 1];
    if (entry.address.indexOf(".m3u8") < 0) {
      throw new Error("片源返回的不是直链播放地址");
    }
    const media = { url: entry.address, referer: referer };
    return host.prepareWebMedia(media, SOURCE_NAME);
  }
  const entry = entries[0];
  if (entry.address.indexOf(".m3u8") < 0) {
    throw new Error("片源返回的不是直链播放地址");
  }
  // 片源自报的集数优先（红果与片源集数可能差一两集），否则用红果的
  const declared = remarkCount(match.item);
  const sliceTotal = declared > 0 ? declared : Math.max(total, 1);
  const sliceIndex = Math.min(Math.max(index, 1), sliceTotal);
  const loaded = loadPlaylist(entry.address, referer);
  const sliced = slicePlaylist(loaded, sliceIndex, sliceTotal);
  return host.finishMedia({
    url: directoryOf(loaded.base),
    playlist: sliced.playlist,
    referer: referer,
    durationMs: sliced.durationMs,
  });
}

function resolveVideo(task) {
  const prefix = host.source + ":";
  const dramaId = task.dramaId.indexOf(prefix) === 0 ? task.dramaId.slice(prefix.length) : "";
  if (!/^[0-9]{1,32}$/.test(dramaId)) {
    throw new Error("剧集信息无效，请刷新详情");
  }
  const index = intOf(task.index, 0) || intOf(nested(task.chapter, "currentEpisode"), 1) || 1;
  const total = episodeCount(dramaId);
  const title = firstNonEmpty(task.dramaTitle, nested(task.drama, "title"));
  const match = matchLibrary(title);
  if (!match) {
    throw new Error("片源站没有找到《" + title + "》，换个剧源或稍后再试");
  }
  const media = resolveFromLibrary(match, index, total);
  if (media && media.url) {
    return media;
  }
  throw new Error("片源站没有返回可播放的地址");
}

module.exports = {
  validCategory(category) {
    if (category === "" || category === undefined || category === null) {
      return true;
    }
    return genres.some((genre) => genre.key === category);
  },

  categories() {
    return genres.map((genre) => ({ id: genre.key, name: genre.name }));
  },

  catalogPage(page, category) {
    return this.discover(category, page);
  },
  search(page, query) {
    const keyword = stringOf(query);
    const number = intOf(page, 1) || 1;
    if (keyword === "" || number > 1) {
      return { items: [], hasMore: false };
    }
    const tier = searchTier(keyword);
    const collected = [];
    const seen = {};
    for (const library of libraries) {
      let list;
      try {
        list = librarySearch(library, keyword);
      } catch (error) {
        continue;
      }
      for (const item of list) {
        const entry = catalogEntry(library, item);
        if (!entry || seen[entry.sourceId]) {
          continue;
        }
        seen[entry.sourceId] = true;
        entry.rank = searchRank(entry.title, keyword, entry.part);
        collected.push(entry);
      }
    }
    const deduped = dedupeByLibrary(collected.sort((left, right) => right.rank - left.rank));
    const collected2 = deduped;
    const items = collected2.filter((entry) => entry.rank >= tier).slice(0, 40);
    for (const entry of items) {
      delete entry.rank;
    }
    return { items: items, hasMore: false };
  },
  suggestions(query) {
    const keyword = stringOf(query);
    if (keyword === "") {
      return [];
    }
    const address =
      suggestionUrl +
      "?app_id=" + suggestionAppId +
      "&query=" + encodeURIComponent(keyword) +
      "&count=10";
    try {
      const data = parseJson(host.fetchText({ url: address, referer: siteBaseUrl + "/" }).body);
      const words = [];
      for (const row of anyList(data.suggest_list)) {
        const name = firstNonEmpty(nested(row, "video_data", "series_title"), row.name);
        if (name !== "" && words.indexOf(name) < 0) {
          words.push(name);
        }
      }
      return words;
    } catch (error) {
      return [];
    }
  },

  detail(sourceId) {
    const key = stringOf(sourceId);
    const cached = catalogCache[key];
    if (!cached) {
      throw new Error("片源条目已过期，请回到列表重新进入");
    }
    const chapters = [];
    const count = Math.max(intOf(cached.total, 1), 1);
    for (let index = 0; index < count; index++) {
      chapters.push({
        id: host.chapterId(key, String(index + 1)),
        source: host.source,
        title: "第" + (index + 1) + "集",
        currentEpisode: index + 1,
      });
    }
    const entry = cached.entry;
    entry.totalEpisode = chapters.length;
    entry.episodeCount = chapters.length;
    return { drama: entry, chapters: chapters };
  },
  resolveMedia(task) {
    const prefix = host.source + ":";
    const key = stringOf(task.dramaId).indexOf(prefix) === 0 ? stringOf(task.dramaId).slice(prefix.length) : "";
    const cached = catalogCache[key];
    if (!cached) {
      throw new Error("片源条目已过期，请回到列表重新进入");
    }
    const index = intOf(task.index, 0) || intOf(nested(task.chapter, "currentEpisode"), 1) || 1;
    let media = null;
    try {
      media = playFromItem(cached.item, index, cached.library);
    } catch (error) {
      const title = firstNonEmpty(task.dramaTitle, nested(task.drama, "title"), cached.entry.title);
      const retry = matchLibrary(title, cached.library.id);
      if (!retry) {
        throw error;
      }
      media = playFromLibrary(retry, index, cached.entry.totalEpisode || 1);
    }
    if (media && media.url) {
      return media;
    }
    throw new Error("片源站没有返回可播放的地址");
  },

  discover(genreKey, page) {
    const number = intOf(page, 1) || 1;
    const limit = 48;
    const cursors = libraries.map((library) => ({ library: library, at: (number - 1) * 2 + 1, done: false }));
    const items = [];
    const seen = {};
    let active = cursors.length;
    while (active > 0 && items.length < limit) {
      for (const cursor of cursors) {
        if (cursor.done) {
          continue;
        }
        let list;
        try {
          list = libraryLatest(cursor.library, cursor.at);
        } catch (error) {
          cursor.done = true;
          active -= 1;
          continue;
        }
        cursor.at += 1;
        shuffle(list);
        let added = 0;
        for (const item of list) {
          const entry = catalogEntry(cursor.library, item);
          if (!entry || seen[entry.sourceId]) {
            continue;
          }
          seen[entry.sourceId] = true;
          items.push(entry);
          added += 1;
          if (items.length >= limit) {
            break;
          }
        }
        if (list.length === 0 || added === 0 && cursor.at - (number - 1) * 2 > 3) {
          cursor.done = true;
          active -= 1;
        }
        if (items.length >= limit) {
          break;
        }
      }
    }
    // 按来源轮转，保证首页九源都能露脸
    const byLibrary = {};
    for (const entry of items) {
      const bucket = byLibrary[entry.libraryName] || (byLibrary[entry.libraryName] = []);
      bucket.push(entry);
    }
    const mixed = [];
    let more = true;
    while (more) {
      more = false;
      for (const key of Object.keys(byLibrary)) {
        const entry = byLibrary[key].shift();
        if (entry) {
          mixed.push(entry);
        }
        if (byLibrary[key].length) {
          more = true;
        }
      }
    }
    return { items: mixed, hasMore: items.length >= limit };
  },


};
const catalogCache = {};

function hashOf(text) {
  let hash = 5381;
  for (let index = 0; index < text.length; index++) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) % 2147483647;
  }
  return String(hash);
}

function shuffle(items) {
  for (let index = items.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    const tmp = items[index];
    items[index] = items[swap];
    items[swap] = tmp;
  }
}

function kindOf(item) {
  const type = stringOf(item.type_name || item.vod_class);
  if (type.indexOf("综艺") >= 0) {
    return { key: "variety", name: "综艺" };
  }
  if (type.indexOf("动漫") >= 0 || type.indexOf("动画") >= 0 || type.indexOf("国漫") >= 0 || type.indexOf("日漫") >= 0) {
    return { key: "anime", name: "动漫" };
  }
  return { key: "series", name: "连续剧", hint: type };
}

function partGuessOf(item) {
  const name = stringOf(item.vod_name);
  const match = /第\s*([0-9零〇一二两兩三四五六七八九十百]+)\s*[季部]/u.exec(name);
  return match ? Chinese(match[1]) : 0;
}

function Chinese(text) {
  const digits = "零一二三四五六七八九";
  if (/^[0-9]+$/.test(text)) {
    return intOf(text, 0);
  }
  if (text.length === 1) {
    const only = digits.indexOf(text);
    return only >= 0 ? only : 0;
  }
  const ten = text.indexOf("十");
  if (ten < 0) {
    return 0;
  }
  const tens = ten === 0 ? 1 : digits.indexOf(text.charAt(0));
  const ones = ten === text.length - 1 ? 0 : digits.indexOf(text.charAt(ten + 1));
  return (tens > 0 ? tens : 0) * 10 + (ones > 0 ? ones : 0);
}

function catalogEntry(library, item) {
  const name = stringOf(item.vod_name);
  const id = stringOf(item.vod_id);
  if (name === "" || id === "") {
    return null;
  }
  const group = pickGroup(item);
  if (!group) {
    return null;
  }
  const kind = kindOf(item);
  const total = Math.max(group.entries.length, remarkCount(item) || 1);
  const cover = stringOf(item.vod_pic);
  const categoryName = (stringOf(item.type_name) || kind.name).replace(/,$/, "");
  const key = library.id + "-" + hashOf(id + name);
  const entry = {
    id: host.dramaId(key),
    source: host.source,
    sourceId: key,
    title: name,
    name: name,
    desc: stringOf(item.vod_content) || stringOf(item.vod_blurb),
    intro: stringOf(item.vod_content) || stringOf(item.vod_blurb),
    cover: cover,
    coverUrl: cover,
    categoryName: categoryName,
    channelName: kind.name,
    remark: firstNonEmpty(item.vod_remarks, "共" + total + "集"),
    totalEpisode: total,
    episodeCount: total,
    part: partGuessOf(item),
    libraryName: library.name,
  };
  catalogCache[key] = { entry: entry, item: item, library: library, total: total };
  return entry;
}

function libraryLatest(library, page) {
  const address = library.base + "?ac=detail&pg=" + page;
  const body = host.fetchText({ url: address, referer: library.base }).body;
  return anyList(parseJson(body).list);
}

function playFromItem(item, index, library) {
  const group = pickGroup(item);
  if (!group) {
    throw new Error("片源没有可播放的线路");
  }
  return playEntries(library, group.entries, index, remarkCount(item));
}

function playFromLibrary(match, index, total) {
  const declared = remarkCount(match.item);
  const size = declared > 0 ? declared : Math.max(intOf(total, 1), 1);
  return playEntries(match.library, match.group.entries, index, size);
}

function playEntries(library, entries, index, declared) {
  const referer = library.base;
  const size = Math.max(intOf(declared, 0), 1);
  if (entries.length > 1 && size > 1) {
    const pick = entries.length === size ? index : Math.min(Math.max(index, 1), entries.length);
    const entry = entries[pick - 1] || entries[0];
    if (entry.address.indexOf(".m3u8") < 0) {
      throw new Error("片源返回的不是直链播放地址");
    }
    return host.prepareWebMedia({ url: entry.address, referer: referer }, SOURCE_NAME);
  }
  const entry = entries[0];
  if (entry.address.indexOf(".m3u8") < 0) {
    throw new Error("片源返回的不是直链播放地址");
  }
  const sliceIndex = Math.min(Math.max(index, 1), size);
  const loaded = loadPlaylist(entry.address, referer);
  const sliced = slicePlaylist(loaded, sliceIndex, size);
  return host.finishMedia({
    type: "playlist",
    content: sliced.playlist,
    baseUrl: loaded.base,
    durationMs: sliced.durationMs,
    referer: referer,
    name: SOURCE_NAME,
  });
}

// —— 搜索结果排序：区分港剧 / 美剧 / 国产剧与误命中 ——
function titled(normalized) {
  let text = normalized;
  for (let round = 0; round < 4; round++) {
    const cut = text.replace(/第[0-9零一二三四五六七八九十百]+[季部篇]$/u, "");
    if (cut === text) {
      break;
    }
    text = cut;
  }
  return text;
}

function searchRank(name, query, part) {
  const title = normalizeTitle(name);
  const wanted = normalizeTitle(query);
  const base = titled(title) === titled(wanted) ? 55 : title === wanted ? 50 : similarity(title, wanted);
  if (base === 0) {
    return 0;
  }
  let rank = Math.min(base, 60);
  if (title.indexOf("解说") >= 0 || title.indexOf("盘点") >= 0 || title.indexOf("影评") >= 0) {
    rank -= 25;
  }
  const isSeries = part > 0;
  rank += isSeries ? 15 : -6;
  if (part > 0) {
    rank += part * 0.5;
  }
  return rank;
}

//// 合并同源重复：同一部剧同一来源只留一条（不同集数与清晰度算重复）
function dedupeByLibrary(entries) {
  const seen = {};
  const out = [];
  for (const entry of entries) {
    const key = entry.libraryName + "|" + titled(normalizeTitle(entry.title));
    if (seen[key]) {
      continue;
    }
    seen[key] = true;
    out.push(entry);
  }
  return out;
}
function searchTier(query) {
  const raw = stringOf(query);
  const wanted = normalizeTitle(raw);
  if (/[A-Za-z\u4e00-\u9fa5]/.test(raw) && /[A-Za-z]/.test(raw)) {
    return 22;
  }
  if (wanted.length <= 2) {
    return 38;
  }
  return 26;
}