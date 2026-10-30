# ADR 0001：个人文章的真实语言版本与安全 Markdown

状态：采用，2026-10-30（B-03-05）。

使用 Astro 7.4.2 Content Collections 的 glob loader 读取 `src/content/articles/**/*.md`；`src/content.config.ts` 使用 Zod 校验 title、locale、slug、translationKey。slug 和 translationKey 是稳定的小写 ASCII 单段标识；locale 使用 CMS Locale 代码，例如 zh-CN。ID 按相对文件名生成，避免共享 slug 的译文互相覆盖。

路由为 `/{CMS urlSegment}/articles/{slug}/`。在 SSG 时取得既有 CMS 启用语言 Manifest，与真实文章条目取交集。translationKey 关联独立正文，可使用不同 slug；同 key+locale 或同 locale+slug 重复会阻断构建，空正文也阻断。禁用/未配置的文章语言不生成路径或版本链接，但所有文件仍须通过元数据和唯一性校验。不要求英语存在，不创建任何文章正文回退。

glob 保留 Markdown body，使用 deferRender 避免预先渲染。页面仅渲染本站 `renderMarkdown()` 结果；markdown-it 14.1.0 设置 html:false，原始 HTML 显示为转义文本，并保留内置危险 URL 协议校验。不使用 MDX，不执行正文脚本。`set:html` 只能接收处理后的 HTML，不能接收 CMS 或文件原文。普通链接/图片沿用 Markdown 规则；图片资源仍应由站点管理。

URL 由现有 languageHref/base 工具和 articleHref 生成，不硬编码 zh-CN 的 URL。只有最小 HTML 与真实版本链接，没有文章列表、视觉排版、SEO 发布或 Solana 项目页。

样本：中文独立 chinese-only，及共享 translationKey=markdown-pipeline 的中英文章。添加译文时新增真实文件，保持 key 稳定；修改 key 会改变关联，不能据标题猜测译文。

来源：[Astro Content Collections](https://docs.astro.build/en/guides/content-collections/)；具体 API 同时依据本机 7.4.2 的 glob 类型定义核对。
