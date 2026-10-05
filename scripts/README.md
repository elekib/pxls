# Scripts

Optional helpers, not required to run pxls.

- `gpu_metrics.py`: reads Intel iGPU temperature and load from sysfs. Linux with an Intel GPU only.
- `gpu_server.py`: serves those metrics over HTTP in a dashdot-compatible `/load/gpu` format, for use as a GPU stats page source.

Run on the host that has the GPU: `python3 scripts/gpu_server.py`.
