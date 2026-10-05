//============================================================================================================================================
//                                                             VERIFYCONTROLS.CJS
//============================================================================================================================================
// 📦 Actual field rebuilds after external deformation, rejection of invalid coordinates, animation and resolution controls.

const Assert = require('node:assert/strict'), Fs = require('node:fs'), { createHash } = require('node:crypto');
const { chromium } = require('playwright'), Chromium = require('@sparticuz/chromium');
const Destination = process.argv[2] || '_AgentScratch/DistanceProof';
const Report = { Date: '2026-10-05', Errors: [], SourceHashes: {} };
for (const Name of Fs.readdirSync('Frontier/Experimental/DistanceIntegrator').filter(Name => /\.(js|css|html)$/.test(Name)))
    Report.SourceHashes[Name] = createHash('sha256').update(Fs.readFileSync(`Frontier/Experimental/DistanceIntegrator/${Name}`)).digest('hex');
(async () =>
{
    const Browser = await chromium.launch({ executablePath: await Chromium.executablePath(),
        args: [...Chromium.args.filter(Argument => !['--in-process-gpu', '--single-process'].includes(Argument)), '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader'],
        env: { ...process.env, LD_LIBRARY_PATH: '/tmp:/tmp/lib', VK_ICD_FILENAMES: '/tmp/vk_swiftshader_icd.json' } });
    try
    {
        const Page = await Browser.newPage({ viewport: { width: 1000, height: 800 } }); Page.setDefaultTimeout(180000);
        Page.on('pageerror', Error => Report.Errors.push(Error.message)); Page.on('console', Message => { if (Message.type() === 'error') Report.Errors.push(Message.text()); });
        const Url = process.env.DISTANCE_URL || 'http://localhost:8080/Frontier/Experimental/DistanceIntegrator/index.html';
        await Page.goto(Url + '?manual=1'); await Page.waitForFunction(() => DistanceApp?.Metrics.Completed > 0 || DistanceApp?.Metrics.Error);
        Assert.equal(await Page.evaluate(() => DistanceApp.Metrics.Error), null);
        Report.External = await Page.evaluate(async () =>
        {
            const Application = DistanceApp, { DeformPosition } = await import('./BodySpecification.js');
            Application.Configure({ Resolution: 32, View: 2 }); await Application.Step(.2);
            const Before = await Application.Readback('Field');
            const Positions = Application.Scene.Vertices.map(Position => DeformPosition(Position, .2));
            for (const Position of Positions) if (Position[3]) Position[1] -= .09 * Math.exp(-((Position[0] - .7) ** 2 + (Position[2] - 1) ** 2) / .3);
            Application.SupplyPositions(Positions.flat()); await Application.Step(.2);
            const After = await Application.Readback('Field');
            const Vertices = new Float32Array(await Application.ReadResource(Application.Vertices, Positions.length * 16));
            let Error = 0; for (let Index = 0; Index < Positions.length; Index++) for (let Axis = 0; Axis < 3; Axis++) Error = Math.max(Error, Math.abs(Vertices[Index * 4 + Axis] - Math.fround(Positions[Index][Axis])));
            let Difference = 0; for (let Index = 0; Index < Before.Pixels.length; Index += 4) Difference += Math.abs(Before.Pixels[Index] - After.Pixels[Index]);
            let Rejected = 0;
            for (const Invalid of [NaN, Number.MAX_VALUE, 99])
            {
                const Copy = Positions.flat(); Copy[0] = Invalid;
                try { Application.SupplyPositions(Copy); } catch { Rejected++; }
            }
            const Static = Positions.flat(); Static[Static.length - 4] += .1;
            try { Application.SupplyPositions(Static); } catch { Rejected++; }
            Application.ResumeProcedural(); await Application.Step(.2);
            const Replay = await Application.Readback('Field');
            let ReplayDifference = 0; for (let Index = 0; Index < Before.Pixels.length; Index++) ReplayDifference += Math.abs(Before.Pixels[Index] - Replay.Pixels[Index]);
            return { Error, Difference, Rejected, ReplayDifference, Metrics: { ...Application.Metrics } };
        });
        Assert.equal(Report.External.Error, 0); Assert(Report.External.Difference > 1); Assert.equal(Report.External.Rejected, 4); Assert.equal(Report.External.ReplayDifference, 0);
        const Width = await Page.evaluate(() => DistanceApp.Metrics.Width);
        await Page.locator('#Scale').evaluate(Input => { Input.value = '.25'; Input.dispatchEvent(new Event('input', { bubbles: true })); });
        await Page.evaluate(() => DistanceApp.Step(.2)); Assert((await Page.evaluate(() => DistanceApp.Metrics.Width)) < Width); Report.RenderScale = true;
        await Page.goto(Url + '?width=128'); await Page.waitForFunction(() => DistanceApp?.Metrics.Completed > 0 || DistanceApp?.Metrics.Error);
        const Previous = await Page.evaluate(() => { DistanceApp.Configure({ Animate: true, Resolution: 32, View: 2 }); return DistanceApp.Metrics.Completed; });
        await Page.waitForFunction(Previous => DistanceApp.Metrics.Completed >= Previous + 3 || DistanceApp.Metrics.Error, Previous);
        await Page.click('#Pause'); Assert.equal(await Page.evaluate(() => DistanceApp.Configuration.Animate), false);
        const Paused = await Page.evaluate(() => DistanceApp.Configuration.Amount);
        await Page.waitForFunction(Amount => Math.abs(DistanceApp.Metrics.Amount - Amount) < 1e-8, Paused);
        await Page.evaluate(() => DistanceApp.Stop()); await Page.waitForFunction(() => !DistanceApp.Metrics.Busy);
        Report.Animation = await Page.evaluate(() => ({ ...DistanceApp.Metrics }));
        Assert.equal(Report.Animation.Error, null); Assert.equal(Report.Animation.Revision, Report.Animation.FieldRevision); Assert(Report.Animation.FieldBuilds >= 3);
        Assert.deepEqual(Report.Errors, []); Report.Passed = true;
    }
    finally { Fs.writeFileSync(`${Destination}/Controls.json`, JSON.stringify(Report, null, 2)); await Browser.close(); }
})().catch(Error => { console.error(Error); process.exit(1); });
