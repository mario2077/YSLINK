# YSLINK · 影视模块包

小果影视 / 同类壳可直接安装的模块包。每个 zip 的根目录只有 `manifest.json` + `main.js`，不套文件夹。

## 包列表

| 模块 | 文件 | 说明 |
| --- | --- | --- |
| 多线影视 v1.0.0 | `duoxian-yingshi-v1.0.0.zip` | 爱看机器人全网聚合，单片 30~60 条线路，自动探活排序，可切换线路 |
| 影视聚合 v1.0.0 | `yingshi-juhe-v1.0.0.zip` | 9 个 macCMS 采集站互备，国产剧 / 综艺 / TVB / 美剧 / 动漫 |
| 红果全集版 v1.0.0 | `hongguo-quanji-v1.0.0.zip` | 红果短剧，5 个采集站兜底 |

## 地址安装

```
https://raw.githubusercontent.com/mario2077/YSLINK/main/duoxian-yingshi-v1.0.0.zip
https://raw.githubusercontent.com/mario2077/YSLINK/main/yingshi-juhe-v1.0.0.zip
https://raw.githubusercontent.com/mario2077/YSLINK/main/hongguo-quanji-v1.0.0.zip
```

国内可用 jsDelivr 加速：

```
https://cdn.jsdelivr.net/gh/mario2077/YSLINK@main/duoxian-yingshi-v1.0.0.zip
https://cdn.jsdelivr.net/gh/mario2077/YSLINK@main/yingshi-juhe-v1.0.0.zip
https://cdn.jsdelivr.net/gh/mario2077/YSLINK@main/hongguo-quanji-v1.0.0.zip
```

仓库里的 `duoxian-yingshi/`、`yingshi-juhe/` 是同一模块的目录形态，给需要填目录地址的壳用。

## 装法

1. App 的「模块」页 → 从文件安装，选下载到的 zip；
2. 或「从地址安装」粘贴上面的 zip 直链；
3. 装好后在影视首页切换来源。

> zip 根目录必须是 `manifest.json` 和 `main.js`；本地安装不会自动更新，更新请重新装。

## 实测

多线影视：搜索约 2s，详情 20~24s（含线路探活），点播 <5ms。探活最多看 12 条、命中 3 条可播即停，结果缓存 30 分钟。
