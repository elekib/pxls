# Scripts

Optional helpers, not required to run pxls.

- `gpu_metrics.py`: reads Intel iGPU temperature and load from sysfs. Linux with an Intel GPU only.
- `gpu_server.py`: serves those metrics over HTTP in a dashdot-compatible `/load/gpu` format, for use as a GPU stats page source.
- `clean_ghcr.py`: maintainers only. Deletes old versions of the `pxls` container package on GHCR (`sha-*`, `exp-*` and orphaned untagged versions), keeping the images behind `dev`, `latest` and release tags. A dry run by default; `--delete` removes, `--all` removes everything. Needs the `gh` CLI with the `read:packages` and `delete:packages` scopes.

Run on the host that has the GPU: `python3 scripts/gpu_server.py`.
