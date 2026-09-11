//==========================================================================================
// Device bring-up and capability reporting. WebGPU only (compute shaders with storage
// buffers and 3D textures are load bearing for the solver), with an explicit report instead
// of a silent fallback.
//==========================================================================================

export async function createDevice()
{
    if (!('gpu' in navigator))
    {
        throw new Error('WebGPU is not available in this browser. Use Chrome/Edge 121+, or Firefox 141+ on Windows.');
    }
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter)
    {
        throw new Error('No WebGPU adapter was returned. Check that hardware acceleration is enabled.');
    }
    const limits = {};
    const adapterLimits = adapter.limits;
    const wanted = [
        ['maxTextureDimension3D', 256],
        ['maxStorageBufferBindingSize', 192 * 1024 * 1024],
        ['maxBufferSize', 256 * 1024 * 1024],
        ['maxComputeWorkgroupsPerDimension', 65535],
        ['maxComputeInvocationsPerWorkgroup', 256],
        ['maxComputeWorkgroupSizeX', 64],
        ['maxBindGroups', 4],
        ['maxUniformBufferBindingSize', 4096],
    ];
    for (const [name, minimum] of wanted)
    {
        const supported = adapterLimits[name];
        limits[name] = supported === undefined ? minimum : Math.min(supported, Number.MAX_SAFE_INTEGER);
        if (supported !== undefined && supported < minimum)
        {
            limits[name] = supported;
        }
    }
    const requiredLimits = {};
    for (const [name] of wanted)
    {
        if (adapterLimits[name] !== undefined)
        {
            requiredLimits[name] = name === 'maxStorageBufferBindingSize' || name === 'maxBufferSize'
                ? Math.min(adapterLimits[name], 512 * 1024 * 1024)
                : adapterLimits[name];
        }
    }

    const device = await adapter.requestDevice({ requiredLimits });
    const info = adapter.info || {};
    return {
        adapter,
        device,
        info: {
            vendor: info.vendor || 'unknown',
            architecture: info.architecture || 'unknown',
            description: info.description || 'WebGPU adapter',
            maxTexture3D: adapterLimits.maxTextureDimension3D,
            maxStorageBuffer: requiredLimits.maxStorageBufferBindingSize || adapterLimits.maxStorageBufferBindingSize,
        },
    };
}

export function attachDeviceDiagnostics(device, onProblem)
{
    device.addEventListener('uncapturederror', (event) => {
        onProblem?.(String(event.error?.message || event.error));
    });
    device.lost.then((info) => {
        onProblem?.(`Device lost (${info.reason}): ${info.message}`);
    });
}

export function createShaderModuleChecked(device, label, code, onProblem)
{
    device.pushErrorScope('validation');
    const module = device.createShaderModule({ label, code });
    // Compilation info is authoritative even when the module is created without throwing.
    module.getCompilationInfo().then((info) => {
        for (const message of info.messages)
        {
            if (message.type === 'error')
            {
                onProblem?.(`${label}:${message.lineNum}:${message.linePos} ${message.message}`);
            }
        }
    }).catch(() => {});
    device.popErrorScope().then((error) => {
        if (error)
        {
            onProblem?.(`${label}: ${error.message}`);
        }
    }).catch(() => {});
    return module;
}
