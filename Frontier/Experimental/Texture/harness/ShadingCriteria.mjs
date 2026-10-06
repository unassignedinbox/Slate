//============================================================================================================================================
// 🔎 ShadingCriteria.mjs — what has to be true of the GLSL, checked without a device to compile it
//============================================================================================================================================
// There is no GPU here, no browser, and no validator. The headless device reports getShaderParameter as true and
// getProgramParameter as one, which means every shader in this editor has always "compiled" and nothing has ever read
// a line of it. A signature can change under three call sites, a sampler can be used before it is declared, a chunk
// can be left off a program's list, and all six hundred and fifty checks still pass while the app draws black.
//
// This reads the eleven programs exactly as the device assembles them — the same preamble, the same chunks, in the
// same order — and holds them to the handful of rules that can be settled from the text alone. It is deliberately
// conservative: a check that cries wolf gets deleted, so anything ambiguous is left for the GPU to find.
//============================================================================================================================================

import { CreateTally } from "./DeviceHost.mjs";
import { Assemblies, AssembleFragment, ShadingHeader } from "../src/ShadingGlsl.js";

const { Check, Report } = CreateTally("the shaders");

//--------------------------------------------------------------------------------------------------------------------------
// Reading GLSL without parsing it. Comments go first — a word inside one is not a use of anything — and strings do
// not exist in this language, so what is left is code.
//--------------------------------------------------------------------------------------------------------------------------
const Strip = (Source) => Source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

// The types a name can be followed by a bracket and still not be a function call. Struct names found in the source
// are added to this, because a struct is its own constructor.
const Constructors = new Set([
    "float", "int", "uint", "bool", "void",
    "vec2", "vec3", "vec4", "ivec2", "ivec3", "ivec4", "uvec2", "uvec3", "uvec4", "bvec2", "bvec3", "bvec4",
    "mat2", "mat3", "mat4", "mat2x2", "mat2x3", "mat2x4", "mat3x2", "mat3x3", "mat3x4", "mat4x2", "mat4x3", "mat4x4",
]);

// Everything declared at the top of a program: uniforms, the varyings that come in, the targets that go out, and the
// constants. Kept apart from one another because a duplicate uniform is a compile error and a shadowed local is not.
const Declarations = (Source) =>
{
    const Found = { Uniform: [], Varying: [], Target: [], Constant: [], Sampler: [] };
    const Pattern = /\b(uniform|in|out|const)\s+(?:highp\s+|mediump\s+|lowp\s+|flat\s+)?([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*(\[\s*\d+\s*\])?/g;
    let Match;
    while ((Match = Pattern.exec(Source)))
    {
        const [, Kind, Type, Name] = Match;
        if (Kind === "uniform")
        {
            Found.Uniform.push(Name);
            if (Type.includes("sampler")) Found.Sampler.push(Name);
        }
        else if (Kind === "in") Found.Varying.push(Name);
        else if (Kind === "out") Found.Target.push(Name);
        else Found.Constant.push(Name);
    }
    return Found;
};

// Every function the source defines, and how many arguments each signature takes. A name can be defined more than
// once at different arities — GLSL overloads — so the answer is a set rather than a number.
const Definitions = (Source) =>
{
    const Found = new Map();
    const Pattern = /\b([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/g;
    let Match;
    while ((Match = Pattern.exec(Source)))
    {
        const [, Type, Name, Parameters] = Match;
        if (Type === "return" || Type === "else" || Name === "if" || Name === "for" || Name === "while") continue;
        const Trimmed = Parameters.trim();
        const Count = Trimmed === "" || Trimmed === "void" ? 0 : Trimmed.split(",").length;
        if (!Found.has(Name)) Found.set(Name, new Set());
        Found.get(Name).add(Count);
    }
    return Found;
};

// Every call to a name that starts with a capital, with the arguments counted at the top level only — a call nested
// inside another call's argument list belongs to that one, and a comma inside a nested bracket is not a separator.
const Calls = (Source) =>
{
    const Found = [];
    const Pattern = /\b([A-Z]\w*)\s*\(/g;
    let Match;
    while ((Match = Pattern.exec(Source)))
    {
        const Name = Match[1];
        let At = Pattern.lastIndex;
        let Depth = 1;
        let Arguments_ = 0;
        let Written = false;
        while (At < Source.length && Depth > 0)
        {
            const Letter = Source[At];
            if (Letter === "(") Depth += 1;
            else if (Letter === ")") Depth -= 1;
            else if (Letter === "," && Depth === 1) Arguments_ += 1;
            else if (Depth === 1 && !/\s/.test(Letter)) Written = true;
            At += 1;
        }
        if (Depth !== 0) continue;
        Found.push({ Name, Count: Written ? Arguments_ + 1 : 0, At: Match.index });
    }
    return Found;
};

const LineOf = (Source, At) => Source.slice(0, At).split("\n").length;

//--------------------------------------------------------------------------------------------------------------------------
// The rules, one program at a time.
//--------------------------------------------------------------------------------------------------------------------------
Check("the device builds every program from one table", Assemblies.length === 11, String(Assemblies.length));
Check("and every entry in it carries a vertex and a fragment", Assemblies.every((Entry) => Entry.Vertex && Entry.Fragment));
Check("the preamble asks for the version first", ShadingHeader.startsWith("#version 300 es\n"));

for (const Assembly of Assemblies)
{
    const Name = Assembly.Name;
    const Fragment = Strip(AssembleFragment(Assembly));
    const Vertex = Strip(`${ShadingHeader}${Assembly.Vertex}`);
    const Declared = Declarations(Fragment);
    const Defined = Definitions(Fragment);
    const Structs = [...Fragment.matchAll(/\bstruct\s+([A-Za-z_]\w*)/g)].map((Match) => Match[1]);
    const Known = new Set([...Constructors, ...Structs]);

    // ── Brackets ────────────────────────────────────────────────────────────────────────────────────────────────────
    for (const [Label, Source] of [["fragment", Fragment], ["vertex", Vertex]])
    {
        const Braces = (Source.match(/\{/g) || []).length - (Source.match(/\}/g) || []).length;
        const Brackets = (Source.match(/\(/g) || []).length - (Source.match(/\)/g) || []).length;
        Check(`${Name} · the ${Label} closes every brace and bracket it opens`, Braces === 0 && Brackets === 0, `{${Braces} (${Brackets}`);
    }

    // ── Uniforms and varyings are declared before they are used ─────────────────────────────────────────────────────
    // 🔴 This works because of the naming, not in spite of it. Every uniform in this editor is uXxx and every varying
    //    is vXxx, so a capital after a lone u or v is a use of one, and there is nothing else in the language it
    //    could be. A convention nobody writes down is worth nothing; one a check depends on gets kept.
    const UsedUniforms = new Set([...Fragment.matchAll(/\bu[A-Z]\w*/g)].map((Match) => Match[0]));
    const UsedVaryings = new Set([...Fragment.matchAll(/\bv[A-Z]\w*/g)].map((Match) => Match[0]));
    const Missing = [...UsedUniforms].filter((Used) => !Declared.Uniform.includes(Used));
    const Unseen = [...UsedVaryings].filter(
        (Used) => !Declared.Varying.includes(Used) && !Declared.Target.includes(Used) && !Defined.has(Used),
    );
    Check(`${Name} · every uniform it reads is declared`, Missing.length === 0, Missing.join(" "));
    Check(`${Name} · every varying it reads is declared`, Unseen.length === 0, Unseen.join(" "));

    // ── Nothing is declared twice ───────────────────────────────────────────────────────────────────────────────────
    // A chunk and the program that pulls it in can both reach for the same sampler, and the shader will not compile.
    const Twice = Declared.Uniform.filter((Entry, Index) => Declared.Uniform.indexOf(Entry) !== Index);
    Check(`${Name} · no uniform is declared twice over`, Twice.length === 0, [...new Set(Twice)].join(" "));

    // ── Every function it calls exists, with the right number of arguments ──────────────────────────────────────────
    const Unknown = [];
    const Mismatched = [];
    for (const Call of Calls(Fragment))
    {
        if (Known.has(Call.Name)) continue;
        if (!Defined.has(Call.Name))
        {
            Unknown.push(`${Call.Name} at ${LineOf(Fragment, Call.At)}`);
            continue;
        }
        const Arities = Defined.get(Call.Name);
        if (!Arities.has(Call.Count))
            Mismatched.push(
                `${Call.Name} called with ${Call.Count}, defined for ${[...Arities].join("/")} at line ${LineOf(Fragment, Call.At)}`,
            );
    }
    Check(`${Name} · every function it calls is one it has`, Unknown.length === 0, Unknown.slice(0, 4).join(" · "));
    Check(`${Name} · and is called with the arguments it takes`, Mismatched.length === 0, Mismatched.slice(0, 3).join(" · "));

    // ── Samplers fit the hardware floor ─────────────────────────────────────────────────────────────────────────────
    // 🔴 WebGL2 guarantees sixteen texture units to a fragment shader and no more. The composite pass is at fifteen.
    //    This is the check that says so out loud rather than leaving the next sampler to be found by a machine that
    //    is not the one it was written on.
    Check(
        `${Name} · stays inside the sixteen samplers WebGL2 promises`,
        Declared.Sampler.length <= 16,
        `${Declared.Sampler.length} samplers`,
    );

    // ── It writes something ─────────────────────────────────────────────────────────────────────────────────────────
    Check(`${Name} · writes to a target of its own`, Declared.Target.length >= 1, Declared.Target.join(" "));
}

//--------------------------------------------------------------------------------------------------------------------------
// The two that nearly went wrong this week, named rather than left to the general rules.
//--------------------------------------------------------------------------------------------------------------------------
const Composite = Strip(AssembleFragment(Assemblies.find((Entry) => Entry.Name === "Composite")));
const MaskPass = Strip(AssembleFragment(Assemblies.find((Entry) => Entry.Name === "Mask")));
for (const [Name, Source] of [["the composite", Composite], ["the mask pass", MaskPass]])
{
    Check(`${Name} declares the measured sheet it samples`, /uniform\s+sampler2D\s+uMeasureMap\s*;/.test(Source));
    Check(`${Name} hands it to every generator it asks`, Calls(Source).filter((Call) => Call.Name === "SampleGenerator").length >= 1);
}
const Headroom = Declarations(Composite).Sampler.length;
Check("the composite has room for one more sampler and no more", Headroom === 15, `${Headroom} of 16`);

Report();
