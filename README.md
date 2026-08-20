# Shanghai Metro Shortest Route (Web App)

一个纯前端网页小应用，用于查询上海地铁任意两站之间的**最短路径**（按线路区间里程最短）与对应票价，并在网络图上高亮显示路径。

## 功能

- 任意两站最短路径查询（Dijkstra，权重为相邻站区间里程）
- 估算里程与票价计算
- 地铁网络图可缩放/拖拽，查询结果高亮显示

## 数据来源（维基百科）

- 站点与线路顺序：
  - 英文维基百科：`Template:Shanghai Metro`
  - 英文维基百科：`Module:Adjacent stations/Shanghai Metro`
- 各线路区间里程：
  - 中文维基百科：`上海轨道交通X号线` / `上海轨道交通浦江线` 页面中“车站列表”的“里程/站间距”列
- 各线路总里程：
  - 中文维基百科：`上海轨道交通X号线` / `上海轨道交通浦江线` 页面中的线路长度字段

> 说明：脚本目前保留英文维基的线路拓扑/颜色来源，但区间里程与线路总长已改为优先使用中文维基百科。若某个相邻区间抓取失败，结果中仍会保留该区间，并写入 `distanceMarker: "WIKIPEDIA_DISTANCE_MISSING"`；对应 `distanceKm` 会按该线路已知区间与总里程做估算填充。

## 运行方式

1. 生成数据：

```bash
node scripts/build-data.mjs
```

2. 运行单元测试：

```bash
node --test
```

3. 启动静态文件服务器（任选其一）：

```bash
python3 -m http.server 8080
# 或
npx serve .
```

4. 打开浏览器访问：`http://localhost:8080`

## 票价规则

按上海地铁里程票价规则估算：

- ≤6km：3元
- 6–16km：4元
- 16–26km：5元
- 26–36km：6元
- 36–46km：7元
- 46–56km：8元
- >56km：每增加20km加1元
