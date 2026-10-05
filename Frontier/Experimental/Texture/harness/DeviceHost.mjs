//============================================================================================================================================
// 🧪 DeviceHost.mjs — a jsdom window with a recording WebGL2 device behind it, so the editor can be driven without a browser
//============================================================================================================================================
// There is no browser in this sandbox and none can be installed, so the only way to drive the real panel is to give it a
// window it believes in. This module builds one: index.html parsed into jsdom, the handful of browser pieces jsdom lacks,
// and a WebGL2 context that answers every call and writes each one into a log the checks can read back.
//
// 🔴 The device is a Proxy rather than a hand-written object on purpose. A stub that only implements what today's code
//    calls fails the day the shader gains a uniform, and it fails SILENTLY — the exception lands in a constructor during
//    DOMContentLoaded, jsdom swallows it, and what you see is a window that simply did nothing.
//============================================================================================================================================

import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";

const Root = new URL("../", import.meta.url);

//--------------------------------------------------------------------------------------------------------------------------
// The device. Every call is recorded as { Name, Parts }; everything that must return something returns something plausible.
//--------------------------------------------------------------------------------------------------------------------------
export const CreateDevice = () =>
{
    const Log = [];
    let Counter = 1;
    const Named = (Kind) => ({ Kind, Identity: Counter++ });

    // 🔴 The backing store sits OUTSIDE the proxy. A field read through the trap would be answered with a freshly
    //    minted logging function, so `Device.Enumerants` would be a function rather than the map it is.
    const State = { Log, Enumerants: new Map([["FRAMEBUFFER_COMPLETE", 36053]]), CanvasElement: null, Calls: new Map() };
    const Constant = (Value) => [...State.Enumerants].find(([, Minted]) => Minted === Value)?.[0] || "";

    const Answers = {
        getExtension: (Name) => (String(Name).includes("float") || String(Name).includes("anisotropic") ? {} : null),
        createShader: () => Named("shader"),
        createProgram: () => Named("program"),
        createTexture: () => Named("texture"),
        createFramebuffer: () => Named("framebuffer"),
        createRenderbuffer: () => Named("renderbuffer"),
        createBuffer: () => Named("buffer"),
        createVertexArray: () => Named("array"),
        getShaderParameter: () => true,
        getProgramParameter: () => 1,           // ACTIVE_UNIFORMS wants a number, and a truthy LINK_STATUS wants one too
        getActiveUniform: () => ({ name: "uUnused", size: 1, type: 0 }),
        getUniformLocation: () => Named("uniform"),
        getAttribLocation: () => 0,
        getShaderInfoLog: () => "",
        getProgramInfoLog: () => "",
        checkFramebufferStatus: () => 36053,
        // 🔴 Answered by the NAME the enumerant was minted under, never by its number: the numbers here are handed
        //    out in the order the editor happens to read them, so a check against a real WebGL value is a coin toss.
        getParameter: (Value) =>
        {
            const Name = Constant(Value);
            if (/MAX_TEXTURE_SIZE|MAX_RENDERBUFFER_SIZE|MAX_VIEWPORT_DIMS|MAX_TEXTURE_IMAGE/.test(Name)) return 16384;
            if (/MAX_DRAW_BUFFERS|MAX_COLOR_ATTACHMENTS|MAX_SAMPLES|SAMPLES/.test(Name)) return 8;
            if (/VERSION|VENDOR|RENDERER|SHADING_LANGUAGE/.test(Name)) return "Harness WebGL2";
            return 16;
        },
        getError: () => 0,
        isContextLost: () => false,
        readPixels: () => undefined,
        getSupportedExtensions: () => [],
    };

    const Device = new Proxy(State, {
        get: (Target, Name) =>
        {
            if (Name in Target) return Target[Name];
            if (typeof Name !== "string") return undefined;
            // The enumerants. WebGL constants are read as properties, and any number will do so long as it is stable.
            if (/^[A-Z0-9_]+$/.test(Name))
            {
                if (!State.Enumerants.has(Name)) State.Enumerants.set(Name, 33000 + State.Enumerants.size);
                return State.Enumerants.get(Name);
            }
            if (Name === "canvas") return State.CanvasElement;
            if (!State.Calls.has(Name))
                State.Calls.set(Name, (...Parts) =>
                {
                    Log.push({ Name, Parts });
                    return Answers[Name] ? Answers[Name](...Parts) : undefined;
                });
            return State.Calls.get(Name);
        },
        set: (Target, Name, Value) => ((Target[Name] = Value), true),
    });
    return Device;
};

//--------------------------------------------------------------------------------------------------------------------------
// The window. index.html, parsed, with the pieces jsdom does not carry.
//--------------------------------------------------------------------------------------------------------------------------
export const CreateWindow = () =>
{
    const Markup = readFileSync(new URL("index.html", Root), "utf8");
    const Console = new VirtualConsole();
    const Faults = [];
    Console.on("jsdomError", (Error_) => Faults.push(Error_));
    const Dom = new JSDOM(Markup, { pretendToBeVisual: true, url: "http://localhost:5173/", virtualConsole: Console });
    const Window = Dom.window;
    const Device = CreateDevice();

    Window.ResizeObserver = class
    {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
    Window.matchMedia =
        Window.matchMedia ||
        (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    Window.HTMLCanvasElement.prototype.getContext = function Context(Kind)
    {
        if (Kind === "webgl2")
        {
            Device.CanvasElement = this;
            return Device;
        }
        return null;                            // jsdom has no raster context, and every drawing path guards for it
    };
    // Laid out: jsdom measures nothing, so every box would be zero wide and every pointer sum would divide by it.
    Window.Element.prototype.getBoundingClientRect = function Box()
    {
        const Wide = this.tagName === "CANVAS" ? 960 : 320;
        const Tall = this.tagName === "CANVAS" ? 540 : 180;
        return { x: 0, y: 0, left: 0, top: 0, right: Wide, bottom: Tall, width: Wide, height: Tall, toJSON: () => ({}) };
    };
    Object.defineProperty(Window.HTMLElement.prototype, "clientWidth", { get: () => 320, configurable: true });
    Object.defineProperty(Window.HTMLElement.prototype, "clientHeight", { get: () => 180, configurable: true });
    Window.HTMLElement.prototype.setPointerCapture = function () {};
    Window.HTMLElement.prototype.releasePointerCapture = function () {};
    Window.HTMLElement.prototype.hasPointerCapture = () => false;
    Window.HTMLElement.prototype.scrollIntoView = function () {};
    Window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    Window.HTMLDialogElement.prototype.close = function () { this.open = false; };

    globalThis.window = Window;
    globalThis.document = Window.document;
    globalThis.Image = Window.Image;
    globalThis.HTMLElement = Window.HTMLElement;
    globalThis.HTMLCanvasElement = Window.HTMLCanvasElement;
    globalThis.Event = Window.Event;
    globalThis.CustomEvent = Window.CustomEvent;
    globalThis.MouseEvent = Window.MouseEvent;
    globalThis.PointerEvent = Window.PointerEvent || Window.MouseEvent;
    globalThis.KeyboardEvent = Window.KeyboardEvent;
    globalThis.DragEvent = Window.DragEvent || Window.Event;
    globalThis.getComputedStyle = (Element_, Pseudo) => Window.getComputedStyle(Element_, Pseudo);
    globalThis.requestAnimationFrame = (Work) => Window.setTimeout(() => Work(Date.now()), 0);
    globalThis.cancelAnimationFrame = (Handle) => Window.clearTimeout(Handle);
    globalThis.ResizeObserver = Window.ResizeObserver;
    globalThis.FontFace = Window.FontFace || class { load() { return Promise.resolve(this); } };
    if (!Window.document.fonts) Window.document.fonts = { add() {}, delete() {}, ready: Promise.resolve() };

    return { Window, Device, Faults };
};

//--------------------------------------------------------------------------------------------------------------------------
// Checks. A tally rather than a framework: these run in one process against one live editor, and the first failure is
// usually the only interesting one.
//--------------------------------------------------------------------------------------------------------------------------
export const CreateTally = (Title) =>
{
    let Passed = 0;
    let Failed = 0;
    const Check = (Name, Condition, Detail = "") =>
    {
        if (Condition) Passed += 1;
        else
        {
            Failed += 1;
            console.log(`FAIL  ${Name}${Detail ? `   — ${Detail}` : ""}`);
        }
    };
    const Report = () =>
    {
        console.log(`${Passed}/${Passed + Failed} checks passed${Title ? ` · ${Title}` : ""}`);
        if (Failed) process.exitCode = 1;
    };
    return { Check, Report };
};

export const Settle = (Window, Turns = 3) =>
    new Promise((Resolve) =>
    {
        let Left = Turns;
        const Step = () => (Left -= 1) <= 0 ? Resolve() : Window.setTimeout(Step, 0);
        Window.setTimeout(Step, 0);
    });
