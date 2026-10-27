//============================================================================================================================================
// 📦 DeviceExchange — the WebGL2 boundary: context, programs, float surfaces, geometry. Nothing above this names GL.
//============================================================================================================================================
// Mirrors the role of Engine/DeviceExchange/SwapchainExchange in the C++ engine: everything hardware-facing is behind
//    this seam so the phases above it read as rendering logic, not API plumbing.

//------------------------------------------------------------------------------------------------------------------------
//                                                     SHADER INDEX
//------------------------------------------------------------------------------------------------------------------------
// Shader sources are split on //@vertex and //@fragment markers, with CommonRecords.glsl injected after the #version
//    line of each phase (GLSL demands #version first).

export class ShaderIndex
{
    constructor()
    {
        this.Common  = "";
        this.Listings = new Map();
    }

    static async Acquire(Names)
    {
        const Index = new ShaderIndex();
        Index.Common = await (await fetch("/Shaders/CommonRecords.glsl")).text();

        await Promise.all(Names.map(async (Name) =>
        {
            const Text = await (await fetch(`/Shaders/${Name}.glsl`)).text();
            Index.Listings.set(Name, Index.#Split(Text));
        }));
        return Index;
    }

    #Split(Text)
    {
        const VertexMark   = Text.indexOf("//@vertex");
        const FragmentMark = Text.indexOf("//@fragment");
        if (VertexMark < 0 || FragmentMark < 0)
            throw new Error("ShaderIndex: source is missing a //@vertex or //@fragment marker");

        return {
            Vertex:   this.#Inject(Text.slice(VertexMark + 9, FragmentMark)),
            Fragment: this.#Inject(Text.slice(FragmentMark + 11))
        };
    }

    // Places CommonRecords immediately after the #version / precision preamble.
    #Inject(Phase)
    {
        const Lines  = Phase.split("\n");
        let   Cursor = 0;
        while (Cursor < Lines.length && !Lines[Cursor].trim().startsWith("#version")) ++Cursor;
        ++Cursor;
        while (Cursor < Lines.length && Lines[Cursor].trim().startsWith("precision")) ++Cursor;

        Lines.splice(Cursor, 0, this.Common);
        return Lines.join("\n");
    }

    Query(Name)
    {
        const Listing = this.Listings.get(Name);
        if (!Listing) throw new Error(`ShaderIndex: '${Name}' was never acquired`);
        return Listing;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    DEVICE EXCHANGE
//------------------------------------------------------------------------------------------------------------------------

export class DeviceExchange
{
    constructor(Canvas)
    {
        const Context = Canvas.getContext("webgl2",
        {
            alpha: false, antialias: true, depth: true, stencil: false,
            powerPreference: "high-performance", preserveDrawingBuffer: false
        });
        if (!Context) throw new Error("WebGL2 is unavailable — this tool needs a WebGL2 context.");

        this.Canvas  = Canvas;
        this.Context = Context;

        // Rendering to 32-bit float surfaces is what makes a GPU physics solver possible at all: positions need
        //    far more precision than an 8-bit render target can carry.
        this.FloatRender = Context.getExtension("EXT_color_buffer_float");
        this.FloatFilter = Context.getExtension("OES_texture_float_linear");
        if (!this.FloatRender) throw new Error("EXT_color_buffer_float is unavailable — the GPU solver needs float render targets.");

        this.TimerExtension = Context.getExtension("EXT_disjoint_timer_query_webgl2");
        this.Programs = new Map();
    }

    //--------------------------------------------------------------------------------------------------------------
    //                                                    PROGRAMS
    //--------------------------------------------------------------------------------------------------------------

    CompileProgram(Name, Listing)
    {
        const GL = this.Context;

        const Build = (Category, Text) =>
        {
            const Shader = GL.createShader(Category);
            GL.shaderSource(Shader, Text.trim());
            GL.compileShader(Shader);
            if (!GL.getShaderParameter(Shader, GL.COMPILE_STATUS))
            {
                const Log = GL.getShaderInfoLog(Shader);
                const Numbered = Text.trim().split("\n").map((Line, Index) => `${String(Index + 1).padStart(4)}| ${Line}`).join("\n");
                throw new Error(`${Name} ${Category === GL.VERTEX_SHADER ? "vertex" : "fragment"} phase failed:\n${Log}\n${Numbered}`);
            }
            return Shader;
        };

        const Vertex   = Build(GL.VERTEX_SHADER,   Listing.Vertex);
        const Fragment = Build(GL.FRAGMENT_SHADER, Listing.Fragment);

        const Program = GL.createProgram();
        GL.attachShader(Program, Vertex);
        GL.attachShader(Program, Fragment);
        GL.linkProgram(Program);
        if (!GL.getProgramParameter(Program, GL.LINK_STATUS))
            throw new Error(`${Name} link failed:\n${GL.getProgramInfoLog(Program)}`);

        GL.deleteShader(Vertex);
        GL.deleteShader(Fragment);

        // Cache every uniform location up front — getUniformLocation is far too slow to call per frame.
        const Uniforms = new Map();
        const Count    = GL.getProgramParameter(Program, GL.ACTIVE_UNIFORMS);
        for (let Index = 0; Index < Count; ++Index)
        {
            const Record = GL.getActiveUniform(Program, Index);
            const Clean  = Record.name.replace(/\[0\]$/, "");
            Uniforms.set(Clean, GL.getUniformLocation(Program, Record.name));
        }

        const Record = { Program, Uniforms, Name };
        this.Programs.set(Name, Record);
        return Record;
    }

    UseProgram(Name)
    {
        const Record = this.Programs.get(Name);
        if (!Record) throw new Error(`DeviceExchange: program '${Name}' was never compiled`);
        this.Context.useProgram(Record.Program);
        this.ActiveProgram = Record;
        return Record;
    }

    // Uniform assignment by inspection of the supplied value — one call site for every scalar, vector and matrix.
    Assign(Name, Value)
    {
        const GL       = this.Context;
        const Location = this.ActiveProgram?.Uniforms.get(Name);
        if (Location === undefined || Location === null) return;      // optimised out — silently ignored

        if (typeof Value === "number")  { GL.uniform1f(Location, Value); return; }
        if (typeof Value === "boolean") { GL.uniform1i(Location, Value ? 1 : 0); return; }

        switch (Value.length)
        {
            case 2:  GL.uniform2fv(Location, Value); break;
            case 3:  GL.uniform3fv(Location, Value); break;
            case 4:  GL.uniform4fv(Location, Value); break;
            case 16: GL.uniformMatrix4fv(Location, false, Value); break;
            default: GL.uniform4fv(Location, Value); break;           // collider arrays arrive as flat vec4 runs
        }
    }

    AssignInteger(Name, Value)
    {
        const Location = this.ActiveProgram?.Uniforms.get(Name);
        if (Location === undefined || Location === null) return;
        this.Context.uniform1i(Location, Value);
    }

    AssignSurface(Name, Surface, Slot)
    {
        const GL       = this.Context;
        const Location = this.ActiveProgram?.Uniforms.get(Name);
        if (Location === undefined || Location === null) return;
        GL.activeTexture(GL.TEXTURE0 + Slot);
        GL.bindTexture(GL.TEXTURE_2D, Surface);
        GL.uniform1i(Location, Slot);
    }

    //--------------------------------------------------------------------------------------------------------------
    //                                                    SURFACES
    //--------------------------------------------------------------------------------------------------------------

    // A float lattice used as both a sampled surface and a render target — the GPU solver's working store.
    CreateLattice(Width, Height, Contents = null)
    {
        const GL      = this.Context;
        const Surface = GL.createTexture();
        GL.bindTexture(GL.TEXTURE_2D, Surface);
        GL.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA32F, Width, Height, 0, GL.RGBA, GL.FLOAT, Contents);
        GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.NEAREST);
        GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.NEAREST);
        GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
        GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
        return Surface;
    }

    CreateTarget(Surface)
    {
        const GL     = this.Context;
        const Target = GL.createFramebuffer();
        GL.bindFramebuffer(GL.FRAMEBUFFER, Target);
        GL.framebufferTexture2D(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, Surface, 0);

        const Status = GL.checkFramebufferStatus(GL.FRAMEBUFFER);
        if (Status !== GL.FRAMEBUFFER_COMPLETE) throw new Error(`DeviceExchange: incomplete target (0x${Status.toString(16)})`);

        GL.bindFramebuffer(GL.FRAMEBUFFER, null);
        return Target;
    }

    // Sheet textures: sRGB-ish colour sampled with trilinear filtering and anisotropy where available.
    CreateSheet(Image, { Repeat = false, Mip = true } = {})
    {
        const GL      = this.Context;
        const Surface = GL.createTexture();
        GL.bindTexture(GL.TEXTURE_2D, Surface);
        GL.pixelStorei(GL.UNPACK_FLIP_Y_WEBGL, false);
        GL.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, Image);

        const Wrap = Repeat ? GL.REPEAT : GL.CLAMP_TO_EDGE;
        GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, Wrap);
        GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, Wrap);
        GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.LINEAR);

        if (Mip)
        {
            GL.generateMipmap(GL.TEXTURE_2D);
            GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.LINEAR_MIPMAP_LINEAR);

            const Anisotropy = GL.getExtension("EXT_texture_filter_anisotropic");
            if (Anisotropy)
            {
                const Ceiling = GL.getParameter(Anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
                GL.texParameterf(GL.TEXTURE_2D, Anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, Ceiling));
            }
        }
        else GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.LINEAR);

        return Surface;
    }

    //--------------------------------------------------------------------------------------------------------------
    //                                                    GEOMETRY
    //--------------------------------------------------------------------------------------------------------------

    CreateAttribute(Contents, Usage = null)
    {
        const GL     = this.Context;
        const Record = GL.createBuffer();
        GL.bindBuffer(GL.ARRAY_BUFFER, Record);
        GL.bufferData(GL.ARRAY_BUFFER, Contents, Usage ?? GL.STATIC_DRAW);
        return Record;
    }

    CreateSequence(Contents)
    {
        const GL     = this.Context;
        const Record = GL.createBuffer();
        GL.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, Record);
        GL.bufferData(GL.ELEMENT_ARRAY_BUFFER, Contents, GL.STATIC_DRAW);
        return Record;
    }

    Viewport(Width, Height)
    {
        this.Context.viewport(0, 0, Width, Height);
    }
}
