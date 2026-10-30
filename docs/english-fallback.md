# 英语回退与翻译报告（B-03-04A）

本层消费已有 CMS Adapter 和 Manifest，不改变 Client、REST 协议、语言配置或 URL 规则。每个仓库独立维护实现，无共享包。

## 英语基准与错误边界

首页请求必须先完成 `getHome("en")`。英语必须为 found，headline 必须是非空白字符串；description 可为 string 或 null。英语不存在、必需字段为空、字段类型错误、401/403、其他 HTTP 错误或网络/超时都会阻断构建。英语有效后才请求 Manifest 中其他启用语言；英语只请求一次。

Client 将 Single Type 404 转为 missing，所以必须先确认同站点、同 Content Type 的英语接口有效。共享 API 路径错误返回 404 时英语基准会失败，不会静默生成可回退页面。通过该保护后，非英语 404 或 data:null 才能作为整项缺失。反向代理专门针对某个 Locale 错误返回 404，单凭 Content API 仍无法与真实未发布区分；真实扩展验收需要核对对应记录和发布状态。

Manifest 结构冲突照常阻断构建。没有捕获认证、网络或类型错误并将它们转成翻译回退。

## 字段协议

- headline 在 REST 中必须为 string；null、缺少键、其他类型均属非法响应，不能回退来掩盖。
- description 在 REST 中必须为 string 或 null；可选表示内容可以为空，不表示允许错误类型或不符合既有协议的缺键。
- 字符串 trim() 后为空，或允许为空的 null，视为内容缺失。有效字符串保留原值。
- 非英语字段有效则原样使用；缺失且英语有内容时使用英语，reason=missing-field。
- 非英语整项 missing 时使用英语，独立 entryMissing=true，字段 reason=missing-entry。
- 英语自身没有的可选字段不生成内容；本地也无内容时 value=null、sourceLocale=null、fallback=false、reason=unavailable-optional。模板不渲染该可选段落。
- 英语可选字段为空但本地提供了有效内容时可以显示本地内容，该字段不进入翻译覆盖率分母。

```ts
interface LocalizedField {
  value: string | null;
  sourceLocale: string | null;
  fallback: boolean;
  reason: "missing-field" | "missing-entry" | "unavailable-optional" | null;
}
```

ResolvedHome 另包含 targetLocale、entryMissing、fallbackKind（none/field/entry）、mixedLanguage、seoRisks，以及 headline/description 字段对象。HomePageProps.content 使用这些字段对象，模板不读取 Strapi 原始结构。

根 html 保留目标语言；每个实际显示字段设置自己的 lang 和来源调试属性。同一页可以同时出现目标语言和英语。没有添加视觉回退徽标、正式布局或主题样式。

## 机器可读报告

静态端点 `/translation-report.json` 在构建时生成报告；有 base 时沿用静态 Host 的 base 挂载。该文件是公开静态产物，仅含元信息，不包含正文、请求头、CMS 地址或凭据。B-04 可以读取它，不依赖在线 CMS。

报告 schemaVersion=1，包含 siteId、contentType、entryId=home、baseLocale=en、coverageScope=enabled-non-base-locales、englishBaseline、languages、totals、warnings。每个语言含 URL 段、整项缺失、回退层级、混合语言与 SEO 风险、字段审计和覆盖率。

字段审计包含 siteId、targetLocale、sourceLocale、contentType、entryId、field、displayed、englishBaselineAvailable、counted、exclusionReason、translated、fallback、reason。translated 表示该字段被统计为目标语言译文；未纳入统计的字段用 exclusionReason 解释，实际来源仍由 sourceLocale 记录。

覆盖率规则：

1. 仅当前站点、启用的非英语目标语言参加翻译统计。英语作为基准保留审计记录，role=baseline，不进入翻译分母。
2. 只统计需要显示、且英语基准存在有效内容的字段。
3. eligibleFields 为上述字段总数，translatedFields 为其中由目标语言直接提供的字段数，fallbackFields 为其中由英语回退的字段数。
4. ratio=translatedFields/eligibleFields，取值 0–1；分母为 0 时返回 null，摘要显示 n/a，不伪造 100%。总比例按字段计数求和，不平均各语言百分比。
5. 英语没有的可选字段被排除，即使本地提供了内容。禁用语言不请求、不进入报告；跨站配置由 Manifest 拒绝。

例如英语两字段有效，中文 headline 有译文但 description 缺失，则中文 eligibleFields=2、translatedFields=1、fallbackFields=1、ratio=0.5。英语的两字段不重复计入分母。

构建过程通过共享 Promise 复用页面与报告的已解析数据，避免重复请求英语或重复记录摘要。报告不含随机时间戳，顺序继承确定性 Manifest。

## warning 与 SEO

成功构建输出一行人类可读翻译摘要。存在回退时使用 console.warn，前缀 WARNING [translations]，但不设置非零退出码。报告 warnings 区分 field-fallback、entry-fallback、translation-coverage、mixed-language-seo-risk、fallback-language-seo-risk。

一页显示多个来源 Locale 时标记 mixed-language；显示内容来源不同于 URL/目标语言时标记 fallback-language-mismatch，整项英语回退也会触发后者。B-04 必须考虑这些混合语言/语言不匹配的 SEO 风险；本阶段不自动生成 Canonical、hreflang、Sitemap 或索引策略。

## 验证与 B-03-04B 边界

pnpm test 使用模拟 REST、纯函数及临时实际 Astro 构建覆盖成功和错误路径。真实验证只读取现有内容，使用个人站中文空 description 验证字段回退；不会删除真实内容来制造负向情况。

现有法语用例仅是 B-03-03 已有的隔离模拟测试。本阶段没有在真实 CMS 新增/启用法语、创建翻译、调整权限或执行真实法语扩展。

B-03-04B 前应单独确认：允许操作的真实 Locale/站点配置和发布内容、变更前恢复点及回滚责任、匹配的只读权限、英语基准有效，以及扩展后的预期路径/计数/报告。全局 Locale 清单权限仍沿用 B-03-03 已记录的 403 限制，不据此声称已核验完整清单。
