#!/usr/bin/env python3
"""
GPU metrics collector for Intel iGPU
Outputs JSON compatible with dashdot's /load/gpu format
"""
import json
import os
import glob

def get_gpu_temp():
    """Get GPU temperature from hwmon sysfs"""
    try:
        # Find GPU hwmon path
        hwmon_paths = glob.glob('/sys/class/drm/card0/device/hwmon/hwmon*/temp1_input')
        if hwmon_paths:
            with open(hwmon_paths[0], 'r') as f:
                millidegrees = int(f.read().strip())
                return millidegrees / 1000.0
    except Exception:
        pass

    # Intel iGPUs don't have separate temp sensors, use CPU package temp
    # as a reasonable approximation (GPU is on same die)
    try:
        for tz in glob.glob('/sys/class/thermal/thermal_zone*'):
            try:
                with open(f"{tz}/type", 'r') as f:
                    tz_type = f.read().strip()
                    if 'pkg_temp' in tz_type or 'x86_pkg_temp' in tz_type:
                        with open(f"{tz}/temp", 'r') as f:
                            millidegrees = int(f.read().strip())
                            return millidegrees / 1000.0
            except:
                continue
    except:
        pass

    return 0.0

def get_gpu_freq():
    """Get current GPU frequency to estimate load"""
    try:
        # Read current frequency
        with open('/sys/class/drm/card0/gt_cur_freq_mhz', 'r') as f:
            cur_freq = int(f.read().strip())

        # Read max frequency
        with open('/sys/class/drm/card0/gt_max_freq_mhz', 'r') as f:
            max_freq = int(f.read().strip())

        # Read RP0 (boost) frequency
        try:
            with open('/sys/class/drm/card0/gt_RP0_freq_mhz', 'r') as f:
                rp0_freq = int(f.read().strip())
                max_freq = max(max_freq, rp0_freq)
        except:
            pass

        if max_freq > 0:
            load = (cur_freq / max_freq) * 100
            return min(load, 100)
    except Exception:
        pass

    return 0.0

def get_gpu_memory_estimate():
    """Estimate GPU memory usage based on system state"""
    try:
        # Read i915 memory info if available
        # This is a rough estimate since Intel iGPU uses shared memory
        with open('/sys/class/drm/card0/gt_cur_freq_mhz', 'r') as f:
            freq = int(f.read().strip())

        # Higher freq generally means more memory activity
        return min(freq / 10, 100)
    except:
        pass

    return 0.0

def get_gpu_metrics():
    """Get GPU metrics from sysfs"""
    # Check if Intel GPU exists
    if not os.path.exists('/sys/class/drm/card0'):
        return None

    try:
        with open('/sys/class/drm/card0/device/vendor', 'r') as f:
            vendor = f.read().strip()
            if vendor != '0x8086':  # Intel vendor ID
                return None
    except:
        pass

    load = get_gpu_freq()
    temp = get_gpu_temp()
    memory = get_gpu_memory_estimate()

    return {
        "load": round(load, 1),
        "temp": round(temp, 1),
        "memory": round(memory, 1)
    }

def main():
    metrics = get_gpu_metrics()

    if metrics:
        output = [metrics]
    else:
        output = []

    print(json.dumps(output))

if __name__ == "__main__":
    main()
