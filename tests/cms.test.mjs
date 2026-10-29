const { Response, Headers, URL } = globalThis;
import assert from "node:assert/strict";
import { test } from "node:test";
import { createCmsClient } from "../src/lib/cms/client.ts";
import { createCmsAdapter } from "../src/lib/cms/adapter.ts";
import { CmsError } from "../src/lib/cms/types.ts";

const SITE_ID = "personal-site";
const HOME_CONTENT_TYPE = "personal-home";
const TOKEN = "synthetic-test-secret-never-a-real-token";
const options = { baseUrl: "http://cms.invalid/", token: TOKEN };
const home = (locale = "en", description = "Description") => ({
  data: { id: 1, documentId: "home-1", locale, headline: "Hello", description },
  meta: {},
});
const language = (locale = "en") => ({
  id: 1,
  documentId: "locale-1",
  siteId: SITE_ID,
  strapiLocale: locale,
  urlSegment: locale === "zh-CN" ? "zh" : locale,
  enabled: true,
  direction: "ltr",
  isDefault: locale === "en",
});
const collection = (data, page = 1, pageSize = 100, total = data.length) => ({
  data,
  meta: {
    pagination: {
      page,
      pageSize,
      pageCount: Math.ceil(total / pageSize),
      total,
    },
  },
});
const response = (body, status = 200) =>
  new Response(JSON.stringify(body), { status });
const mockClient = (body, status = 200) =>
  createCmsClient({
    ...options,
    fetch: async () => response(body, status),
  });

function expectError(kind, status) {
  return (error) => {
    assert.ok(error instanceof CmsError);
    assert.equal(error.kind, kind);
    assert.equal(error.status, status);
    for (const printable of [
      String(error),
      error.stack ?? "",
      JSON.stringify(error),
    ]) {
      assert.ok(!printable.includes(TOKEN));
      assert.ok(!printable.includes("Bearer"));
    }
    assert.equal(error.cause, undefined);
    return true;
  };
}

for (const locale of ["en", "zh-CN"]) {
  test(`reads ${locale} Single Type with Bearer and a flat domain object`, async () => {
    const requests = [];
    const client = createCmsClient({
      ...options,
      fetch: async (input, init) => {
        const url = new URL(String(input));
        requests.push(url);
        assert.equal(url.pathname, `/api/${HOME_CONTENT_TYPE}`);
        assert.equal(url.searchParams.get("locale"), locale);
        assert.equal(
          new Headers(init?.headers).get("Authorization"),
          `Bearer ${TOKEN}`,
        );
        assert.equal(init?.method, "GET");
        assert.equal(init?.redirect, "error");
        return response(home(locale));
      },
    });
    assert.deepEqual(await createCmsAdapter(client).getHome(locale), {
      status: "found",
      locale,
      content: { headline: "Hello", description: "Description" },
    });
    assert.equal(requests.length, 1);
  });
}

test("encodes locale as one query value without injection", async () => {
  const locale = "zh-CN &more=中文/#?+";
  const client = createCmsClient({
    ...options,
    fetch: async (input) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("locale"), locale);
      assert.deepEqual([...url.searchParams.keys()], ["locale"]);
      assert.ok(!url.href.includes("中文"));
      return response(home(locale));
    },
  });
  assert.equal(
    (await createCmsAdapter(client).getHome(locale)).status,
    "found",
  );
});

test("encodes site filters and returns decoupled site-locale fields", async () => {
  const client = createCmsClient({
    ...options,
    fetch: async (input) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/api/site-locales");
      assert.equal(url.searchParams.get("filters[siteId][$eq]"), SITE_ID);
      assert.match(url.search, /filters%5BsiteId%5D%5B%24eq%5D=/u);
      assert.equal(url.searchParams.get("pagination[page]"), "1");
      assert.equal(url.searchParams.get("pagination[withCount]"), "true");
      assert.equal(url.searchParams.get("sort"), "id:asc");
      return response(collection([language()]));
    },
  });
  assert.deepEqual(await createCmsAdapter(client).getSiteLocales(), [
    {
      siteId: SITE_ID,
      strapiLocale: "en",
      urlSegment: "en",
      enabled: true,
      direction: "ltr",
      isDefault: true,
    },
  ]);
});

test("reads all Collection Type pages", async () => {
  const calls = [];
  const client = createCmsClient({
    ...options,
    pageSize: 1,
    fetch: async (input) => {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get("pagination[page]"));
      calls.push(page);
      assert.equal(url.searchParams.get("pagination[pageSize]"), "1");
      return response(
        collection([language(page === 1 ? "en" : "zh-CN")], page, 1, 2),
      );
    },
  });
  assert.deepEqual(
    (await createCmsAdapter(client).getSiteLocales()).map(
      (x) => x.strapiLocale,
    ),
    ["en", "zh-CN"],
  );
  assert.deepEqual(calls, [1, 2]);
});

test("empty Collection Type is an empty array", async () => {
  assert.deepEqual(
    await createCmsAdapter(mockClient(collection([]))).getSiteLocales(),
    [],
  );
});

test("pagination changes fail rather than returning partial data", async () => {
  let calls = 0;
  const client = createCmsClient({
    ...options,
    pageSize: 1,
    fetch: async () => {
      calls++;
      return response(collection([language()], calls, 1, calls === 1 ? 2 : 3));
    },
  });
  await assert.rejects(
    client.getSiteLocales(SITE_ID),
    expectError("invalid-response"),
  );
  assert.equal(calls, 2);
});

test("a later page HTTP failure never returns partial data", async () => {
  let calls = 0;
  const client = createCmsClient({
    ...options,
    pageSize: 1,
    fetch: async () => {
      return ++calls === 1
        ? response(collection([language()], 1, 1, 2))
        : response({ error: TOKEN }, 500);
    },
  });
  await assert.rejects(
    client.getSiteLocales(SITE_ID),
    expectError("http", 500),
  );
});

for (const description of [null, ""]) {
  test(`preserves ${String(description)} description without fallback`, async () => {
    assert.deepEqual(
      await createCmsAdapter(mockClient(home("zh-CN", description))).getHome(
        "zh-CN",
      ),
      {
        status: "found",
        locale: "zh-CN",
        content: { headline: "Hello", description },
      },
    );
  });
}

for (const status of [200, 404]) {
  test(`missing Single Type (${status}) retains its locale without fallback`, async () => {
    const client = mockClient(
      status === 200 ? { data: null } : { error: TOKEN },
      status,
    );
    assert.deepEqual(await createCmsAdapter(client).getHome("zh-CN"), {
      status: "missing",
      locale: "zh-CN",
    });
  });
}

for (const [name, payload] of [
  ["null root", null],
  ["array root", []],
  ["missing data", {}],
  ["array Single Type", { data: [] }],
  ["Strapi 4 attributes", { data: { id: 1, attributes: home().data } }],
  ["error envelope", { data: null, error: { message: TOKEN } }],
  ["wrong returned locale", home("en")],
  ["headline number", { data: { ...home("zh-CN").data, headline: 123 } }],
  ["headline null", { data: { ...home("zh-CN").data, headline: null } }],
  [
    "description boolean",
    { data: { ...home("zh-CN").data, description: false } },
  ],
  ["description missing", { data: { locale: "zh-CN", headline: "Hi" } }],
]) {
  test(`rejects invalid Single Type: ${name}`, async () => {
    await assert.rejects(
      createCmsAdapter(mockClient(payload)).getHome("zh-CN"),
      expectError("invalid-response"),
    );
  });
}

for (const [field, invalid] of [
  ["siteId", "unknown"],
  ["siteId", ["personal-site", "demo-b2b"].find((site) => site !== SITE_ID)],
  ["strapiLocale", null],
  ["strapiLocale", ""],
  ["urlSegment", 7],
  ["urlSegment", ""],
  ["enabled", "true"],
  ["direction", "vertical"],
  ["isDefault", 0],
]) {
  test(`rejects site-locale ${field}=${String(invalid)}`, async () => {
    const client = mockClient(
      collection([{ ...language(), [field]: invalid }]),
    );
    await assert.rejects(
      createCmsAdapter(client).getSiteLocales(),
      expectError("invalid-response"),
    );
  });
}

test("preserves disabled languages and RTL without manifest conflict checks", async () => {
  const record = {
    ...language("ar"),
    direction: "rtl",
    enabled: false,
    isDefault: false,
  };
  const result = await createCmsAdapter(
    mockClient(collection([record, record])),
  ).getSiteLocales();
  assert.equal(result.length, 2);
  assert.equal(result[0]?.direction, "rtl");
  assert.equal(result[0]?.enabled, false);
});

for (const body of [
  { data: null },
  { data: {} },
  { data: [] },
  {
    data: [],
    meta: { pagination: { page: 0, pageSize: 1, pageCount: 0, total: 0 } },
  },
  {
    data: [],
    meta: { pagination: { page: 1, pageSize: 1, pageCount: 2, total: 0 } },
  },
]) {
  test("rejects malformed collection envelopes/pagination", async () => {
    await assert.rejects(
      mockClient(body).getSiteLocales(SITE_ID),
      expectError("invalid-response"),
    );
  });
}

for (const status of [401, 403, 500, 429]) {
  test(`classifies HTTP ${status} and redacts sensitive upstream body`, async () => {
    await assert.rejects(
      createCmsAdapter(
        mockClient({ error: { message: TOKEN } }, status),
      ).getHome("en"),
      expectError(
        status === 401 || status === 403 ? "authorization" : "http",
        status,
      ),
    );
  });
}

test("Collection Type 404 is an HTTP error, not a missing homepage", async () => {
  await assert.rejects(
    mockClient(null, 404).getSiteLocales(SITE_ID),
    expectError("http", 404),
  );
});

test("invalid JSON has a sanitized response error", async () => {
  const client = createCmsClient({
    ...options,
    fetch: async () => new Response(TOKEN),
  });
  await assert.rejects(
    client.getSingleType(HOME_CONTENT_TYPE, "en"),
    expectError("invalid-response"),
  );
});

test("network connection failure has no sensitive upstream cause", async () => {
  const client = createCmsClient({
    ...options,
    fetch: async () => {
      throw new TypeError(`Bearer ${TOKEN}`);
    },
  });
  await assert.rejects(
    client.getSingleType(HOME_CONTENT_TYPE, "en"),
    expectError("network"),
  );
});

test("timeout aborts the request even if the transport ignores abort", async () => {
  let signal;
  const client = createCmsClient({
    ...options,
    timeoutMs: 10,
    fetch: async (_, init) => {
      signal = init?.signal;
      return new Promise(() => {});
    },
  });
  await assert.rejects(
    client.getSingleType(HOME_CONTENT_TYPE, "en"),
    expectError("timeout"),
  );
  assert.equal(signal?.aborted, true);
});

test("timeout also covers reading the response body", async () => {
  const client = createCmsClient({
    ...options,
    timeoutMs: 10,
    fetch: async () => {
      return { ok: true, status: 200, json: () => new Promise(() => {}) };
    },
  });
  await assert.rejects(
    client.getSingleType(HOME_CONTENT_TYPE, "en"),
    expectError("timeout"),
  );
});

test("supports a CMS mounted at a URL prefix", async () => {
  const client = createCmsClient({
    ...options,
    baseUrl: "https://cms.invalid/cms",
    fetch: async (input) => {
      assert.equal(
        new URL(String(input)).pathname,
        `/cms/api/${HOME_CONTENT_TYPE}`,
      );
      return response(home());
    },
  });
  await client.getSingleType(HOME_CONTENT_TYPE, "en");
});

for (const override of [
  { token: "" },
  { token: `${TOKEN}\n` },
  { baseUrl: `https://user:${TOKEN}@cms.invalid` },
  { baseUrl: `https://cms.invalid/?token=${TOKEN}` },
  { baseUrl: `invalid-${TOKEN}` },
  { baseUrl: "file:///cms" },
  { timeoutMs: 0 },
  { timeoutMs: Infinity },
  { pageSize: 0 },
]) {
  test("configuration errors never echo secrets", () => {
    assert.throws(
      () => createCmsClient({ ...options, ...override }),
      expectError("configuration"),
    );
  });
}
