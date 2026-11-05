# Vendored libraries

| File | Library | Version | From | Licence |
| ---- | ------- | ------- | ---- | ------- |
| `orama.js` | [Orama](https://github.com/oramasearch/orama) full-text search (BM25) | **3.1.18**, exactly | `https://cdn.jsdelivr.net/npm/@orama/orama@3.1.18/+esm` (jsDelivr's single-file ES module build of `dist/browser/index.js`) | Apache-2.0, see `orama-LICENSE.md` |

Why it's here instead of a CDN link: the version can't change under the page (the
old page loaded `@orama/orama@3`, which moves with every release and could change
the ranking), and the Content-Security-Policy can stay `script-src 'self'`.

The only edit is the last line (`//# sourceMappingURL=…`, which points at jsDelivr)
being removed. SHA-256 of `orama.js` as committed:
`085d74cb685506fb4992d79be044b232d389a5d27e93e42659482eb9144697e0`.

To update: download the new version's `+esm` file into an empty folder, read it,
check it has no `import` of other URLs, remove the source-map line, copy it here,
run `npm test` (the search tests pin the ranking rules), update this table and the
hash, and log it in `CHANGELOG.md`.
