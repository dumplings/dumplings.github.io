# CMS 语言 Manifest 与 SSG（B-03-03）

本仓库独立维护 CMS 数据层和语言配置，不依赖另一站点的代码或共享包。使用 CMS Manifest + getStaticPaths() 手动生成静态路由，不配置 Astro i18n.locales 静态数组。

## Manifest 协议

`loadLanguageManifest(adapter)` 从 B-03-02 Adapter 的 getSiteLocales() 获取全部记录，再调用纯函数 `createLanguageManifest(records)`。

```ts
interface ManifestLanguage {
  readonly strapiLocale: string;
  readonly urlSegment: string;
  readonly direction: "ltr" | "rtl";
  readonly isDefault: boolean;
}

interface LanguageManifest {
  readonly siteId: "personal-site" | "demo-b2b";
  readonly defaultLanguage: ManifestLanguage;
  readonly languages: readonly ManifestLanguage[];
}
```

固定站点标识来自本仓库 Adapter 导出的 CMS_SITE_ID。先校验全部记录，包括禁用记录，再仅保留 enabled=true：

- 复用 CMS Schema 的字段类型、direction 枚举、布尔值及站点归属校验。
- 同站点 strapiLocale、urlSegment 分别唯一，包括禁用记录。
- 默认语言恰好一条，必须已启用，且 strapiLocale=en、urlSegment=en。
- zh-CN 必须对应 zh。
- URL 段采用保守语法 `[a-z0-9]+(?:-[a-z0-9]+)*`：单个未编码的小写 ASCII 路径段，不允许斜杠、反斜杠、点、百分号、空白、查询参数或片段；拒绝路径穿越和编码分隔符。
- 默认语言排在首位，其余按 URL 段的 ASCII 顺序排序；冻结返回对象和数组，不修改输入。

结构错误抛 ManifestError，带可识别 code。Adapter 更早发现的字段错误仍可能抛 CmsError；两者都会直接阻断构建，没有降级为静态硬编码语言表。

现有只读 Token 对 GET /api/i18n/locales 返回 HTTP 403。Manifest 没有宣称已核验全局 Locale 成员资格，不自动申请权限、不读取全局 Locale 的其他管理接口。启用语言的首页是否可读，由各页的真实内容请求验证；禁用记录以及未被站点引用的全局 Locale 仍不能通过当前 Token 完整核验。

## 路由与页面

`loadSiteBuildContext()` 延迟调用 createCmsClientFromEnv()、createCmsAdapter() 和 loadLanguageManifest()。构建进程内缓存一个 Promise，使根入口与动态路由共享同一不可变语言快照；缓存不写磁盘。CMS 内容或配置变更后需要重新构建。

根页面从 Manifest 默认语言生成英语入口。动态页面的 getStaticPaths() 调用同一个上下文，再通过 createHomeStaticPaths() 逐个调用 Adapter.getHome(strapiLocale)，返回 params.lang=urlSegment 和类型化的 HomePageProps。Client/Token 不进入页面 props。

模板只消费 manifest、language 和 content。所有语言有 URL 前缀，包括 /en/；中文 URL 为 /zh/，html lang 为 zh-CN；阿拉伯语 html dir 为 rtl。导航只列出启用语言。根页用静态 HTML 即时跳转到英语，同时保留可点击链接，不探测浏览器语言。

当前页面只有无样式的语义 HTML、内容字段和配置调试信息，没有正式视觉设计，也没有 Canonical、hreflang、Sitemap 或发布流程。

空字符串/null description 原样渲染为空段落，不做字段回退。若启用语言的整个首页为 missing，构建明确失败，不尝试英语。英语回退留给 B-03-04。

## base 与环境

`languageHref(base, urlSegment)` 统一生成带 base 的绝对路径并保留结尾斜杠，支持 / 和 /demo-industrial/ 之类的路径 base，也支持多段安全 base。页面传入 import.meta.env.BASE_URL，不拼接根域名或 CMS Host。

CMS_URL 和 CMS_READ_API_TOKEN 仍只通过构建/服务端环境提供，由 astro:env/server 读取。不得将真实 Token 写入源码、提交文件、客户端脚本或 PUBLIC_/ASTRO_PUBLIC_ 变量。配置示例没有真实凭据。

SSG 现在需要 CMS 在线及有效构建环境；生成的 HTML 部署后不需要 CMS 在线。

非根 base 可通过 Astro CLI 覆盖验证，无需修改仓库配置：

```sh
pnpm exec astro build --base /demo-industrial/ --outDir /tmp/REPLACE-WITH-A-NEW-OUTPUT-DIRECTORY
```

URL 会变为 /demo-industrial/en/ 等；outDir 中仍以 en/index.html 等形式保存，静态 Host 应将输出目录挂载到对应 base。

## 验证与后续边界

```sh
pnpm test
pnpm check
pnpm lint
pnpm format:check
pnpm build
```

测试使用模拟 REST 和系统临时目录中的实际 Astro 构建，不修改真实 CMS。覆盖禁用语言、配置结构错误、确定性、映射、RTL、base、构建阻断和新增模拟语言自动生成路由。现有 B-03-02 测试继续保留。

全局 Locale 权限、字段/整项回退、正式 UI、Markdown、SEO 与发布均未扩展。B-03-04 可继承 LanguageManifest、ManifestLanguage、HomePageProps、loadSiteBuildContext()、createHomeStaticPaths()、languageHref() 和原有 CMS Adapter。
