# CMS 数据层（B-03-02）

本仓库独立维护 `src/lib/cms/`，不依赖另一站点的代码或共享 npm 包。B-03-03 已由最小动态页面消费数据层；静态构建现在需要有效的构建环境和在线 CMS，参见 [语言 Manifest 与 SSG](language-manifest.md)。

本站 Adapter 固定绑定 `personal-site` → `personal-home`。

## 服务端使用

在 Astro frontmatter 或 Astro 构建/服务端模块上下文中调用以下私有环境工厂；原生 Node 脚本可向 `createCmsClient` 显式传入服务端环境配置：

```ts
import { createCmsClientFromEnv } from "../lib/cms/client";
import { createCmsAdapter } from "../lib/cms/adapter";

const cms = createCmsAdapter(await createCmsClientFromEnv());
const home = await cms.getHome("zh-CN");
const languages = await cms.getSiteLocales();
```

环境变量：

- `CMS_URL`：CMS 根地址，可含部署路径前缀，不包含 `/api`、用户名、密码、查询参数或片段。
- `CMS_READ_API_TOKEN`：已有只读 Content API Token。只通过构建/服务端环境注入；`.env.example` 不含真实凭据。

通过 Astro 的 `astro:env/server` 的 `getSecret` 延迟读取环境。禁止在客户端脚本或客户端组件中导入 Client；Astro 会拒绝其中的服务端环境模块。不得改成 `PUBLIC_`、`ASTRO_PUBLIC_` 或把配置传入客户端组件 props。Client 也有浏览器运行时保护。只导入 `types.ts` 的类型不会产生运行时代码。

## Client 与 Adapter 边界

- `createCmsClient({ baseUrl, token, timeoutMs?, pageSize?, fetch? })`：显式配置工厂，方便测试。默认超时 5000 ms；分页大小默认 100，允许 1–100。
- `createCmsClientFromEnv({ timeoutMs?, pageSize?, fetch? })`：从私有环境读取地址和 Token 的异步工厂；只有调用时才要求配置存在。
- `client.getSingleType(type, locale)`：支持 `personal-home`、`b2b-home`，返回未知类型的 REST envelope；Single Type HTTP 404 规范化为 `{ data: null }`。
- `client.getSiteLocales(siteId)`：编码站点过滤器、稳定按 id 排序，按照分页元信息读取全部页面，返回原始记录数组。分页不合法、读取中数量变化或后续页面失败会报错，不返回部分结果。
- `createCmsAdapter(client)`：固定绑定本仓库站点及对应首页模型，返回以下接口。
- `adapter.getHome(locale)`：返回 `{ status: "found", locale, content: { headline, description } }` 或 `{ status: "missing", locale }`。
- `adapter.getSiteLocales()`：返回 `{ siteId, strapiLocale, urlSegment, enabled, direction, isDefault }[]`。

校验 Strapi 5 扁平字段，不读取 `data.attributes`。`headline` 必须为 string，`description` 必须为 string 或 null；缺字段、错误类型或响应 Locale 不匹配均报错。空字符串和 null 原样保留，不进行英语回退。语言记录只做字段及站点归属校验，不筛除禁用语言，不检查跨记录重复/默认语言冲突，不生成完整 manifest。

## 错误与安全

`CmsError` 提供 `kind` 和可选 `status`。kind 为 `configuration`、`network`、`timeout`、`authorization`、`http` 或 `invalid-response`。401/403 属于 authorization；其他非成功 HTTP 属于 http，Single Type 404 除外。Collection Type 404 仍是 HTTP 错误。

响应 `data: null` 和 Single Type 404 仅表示该已知模型/Locale 的缺失候选，不说明网络或认证失败；404 也可能来自服务器部署错误，真实联调阶段须确认 `/api` 路径正确。适配层不尝试其他语言。

只发送 GET，使用 Bearer 头并拒绝重定向。超时覆盖 fetch 和响应体读取；超时会中止请求。错误只包含固定说明、字段路径及 HTTP 状态，不附加原始异常、URL、请求头或服务端错误正文。Client 不记录日志。调用方不要打印客户端配置或原始 REST 数据。

## 验证

```sh
pnpm test
pnpm check
pnpm lint
pnpm format:check
pnpm build
```

测试采用 ESM JavaScript，使用 Node 24 内置测试运行器直接加载并擦除待测 TypeScript 的类型，不增加依赖。模拟 REST 测试不连接实际 CMS；临时 Astro 构建验证私有环境读取、静态产物无测试 Token、缺失配置报错，以及直接/间接浏览器导入被拒绝。临时目录在测试结束后清理。

pnpm 12 默认可能在运行脚本前自动安装依赖。只使用现有依赖验证时，可以为当前进程设置 `pnpm_config_verify_deps_before_run=false`，无需改动项目配置。

B-03-03 已完成真实 Content API 联调、CMS Manifest、最小语言路由及结构冲突校验，详见 [语言 Manifest 与 SSG](language-manifest.md)。B-03-04A 已在独立消费层实现 [英语回退与翻译报告](english-fallback.md)，Adapter 本身继续保留原始空字段和 missing 状态。Markdown、正式 UI 和 SEO/发布仍留给后续阶段。
