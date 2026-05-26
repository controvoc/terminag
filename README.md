# terminag

*terminag* is a controlled vocabuarly for organizing agricultural research data. It is organized in two main groups

- "variables" defines variable names and units, and, for numeric variables, a miniumum and maximum accepted value.
- "values" defines accepted values for some character variables. For example, country and crop names.

The vocabulary is under development. It is currently used as part of the [Carob](https://carob-data.org) data standard.

You can use *R* package [vocal](https://github.com/controvoc/vocal) to check for compliance with this vocabulary.

## Browser

The vocabulary is also published as a small browsable, searchable website built from this repository. Every CSV under `variables/` and `values/` is rendered as an interactive (sortable, searchable, paginated) table at:

- `index.html` — landing page that lists every table, with a top-level filter.
- `table.html?f=<path>` — interactive view of a single CSV (`f` is the repo-relative path, e.g. `f=values/values_crop.csv`).

### Deployment

The site is built and deployed by the `.github/workflows/pages.yml` GitHub Actions workflow on every push to `main`. The workflow:

1. Copies `values/`, `variables/` and any top-level `values_*.csv` / `variables_*.csv` into `_site/`.
2. Copies the static site assets from `docs/` (minus the build helpers under `docs/_build/`) into `_site/`.
3. Generates `_site/tables.json` (a manifest of every CSV, with row/column counts) via `docs/_build/manifest.py` — so newly added CSV files appear on the index automatically, no source edits needed.
4. Writes a small `config.js` shim that tells the JS the current `repo` / `branch`, used to build the "View CSV on GitHub" and "Edit on GitHub" links on each table page.
5. Uploads `_site/` as a Pages artifact and deploys it with `actions/deploy-pages@v4`.

To enable, set **Settings → Pages → Build and deployment → Source** to *GitHub Actions* on the repository.

### Local preview

```sh
python3 docs/_build/serve.py        # http://localhost:8000
python3 docs/_build/serve.py 8080   # pick a port
```

This assembles the same `_site/` layout locally and serves it with `http.server`.
