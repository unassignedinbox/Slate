// Minimal GLSL->SPIR-V lowering harness (the K0 compile story, cmake-free: prebuilt StandAlone is not
// available in this sandbox, so this drives the same glslang frontend glslc uses directly).
#include "glslang/Public/ShaderLang.h"
#include "SPIRV/GlslangToSpv.h"
#include "glslang/Public/ResourceLimits.h"

#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

using namespace glslang;

// Minimal #include resolver: quote includes resolve against the including file's directory, then
// $ENGINE_DIR and $ENGINE_DIR/Engine (ReSTIRViewport.slang includes "Shaders/..." from Engine/).
class FileIncluder : public TShader::Includer
{
public:
    explicit FileIncluder(std::vector<std::string> Search) : Search_(std::move(Search)) {}

    IncludeResult* includeSystem(const char* headerName, const char* includerName, size_t) override
    {
        return Open(headerName, includerName);
    }
    IncludeResult* includeLocal(const char* headerName, const char* includerName, size_t) override
    {
        return Open(headerName, includerName);
    }
    void releaseInclude(IncludeResult* result) override
    {
        if (!result) return;
        delete static_cast<std::string*>(result->userData);
        delete result;
    }

private:
    IncludeResult* Open(const char* headerName, const char* includerName)
    {
        std::string inc  = headerName;
        std::string base = includerName;
        std::string baseDir;
        const auto slash = base.find_last_of('/');
        if (slash != std::string::npos) baseDir = base.substr(0, slash + 1);
        std::vector<std::string> candidates { baseDir + inc, inc };
        for (const auto& s : Search_) candidates.push_back(s + "/" + inc);
        for (const auto& p : candidates)
        {
            if (std::getenv("INCLUDE_DEBUG")) std::fprintf(stderr, "[includer] '%s' (from '%s') -> try '%s'\n", headerName, includerName, p.c_str());
            FILE* f = std::fopen(p.c_str(), "rb");
            if (!f) continue;
            std::string text;
            int c;
            while ((c = std::fgetc(f)) != EOF) text.push_back(char(c));
            std::fclose(f);
            auto* data = new std::string(std::move(text));
            return new IncludeResult(p.c_str(), data->data(), data->size(), data);
        }
        return new IncludeResult("", nullptr, 0, nullptr);
    }
    std::vector<std::string> Search_;
};

int main(int argc, char** argv)
{
    if (argc < 3) { std::fprintf(stderr, "usage: lower <comp|vert|frag> <file>\n"); return 2; }
    const std::string stage = argv[1];
    const EShLanguage lang = stage == "comp" ? EShLangCompute : (stage == "vert" ? EShLangVertex : EShLangFragment);
    FILE* f = std::fopen(argv[2], "rb");
    if (!f) { std::fprintf(stderr, "cannot open %s\n", argv[2]); return 2; }
    std::string text;
    int c;
    while ((c = std::fgetc(f)) != EOF) text.push_back(char(c));
    std::fclose(f);

    InitializeProcess();
    bool ok = false;
    {
        TShader shader(lang);
        const char* src = text.c_str();
        shader.setStrings(&src, 1);
        shader.setEntryPoint("main");
        shader.setEnvInput(EShSourceGlsl, lang, EShClientVulkan, 100);
        shader.setEnvClient(EShClientVulkan, EShTargetVulkan_1_1);
        shader.setEnvTarget(EShTargetSpv, EShTargetSpv_1_3);
        const std::string eng = std::getenv("ENGINE_DIR") ? std::getenv("ENGINE_DIR") : ".";
        FileIncluder includer({ eng + "/Engine/Shaders", eng + "/Engine", eng });
        if (!shader.parse(GetDefaultResources(), 460, ENoProfile, false, true, EShMsgDefault, includer))
        {
            std::fprintf(stderr, "%s\n%s\n", shader.getInfoLog(), shader.getInfoDebugLog());
        }
        else
        {
            TProgram program;
            program.addShader(&shader);
            if (!program.link(EShMsgDefault) || !program.mapIO())
                std::fprintf(stderr, "LINK:\n%s\n%s\n", program.getInfoLog(), program.getInfoDebugLog());
            else
            {
                std::vector<unsigned int> spirv;
                SpvOptions opt;
                opt.validate = true;
                GlslangToSpv(*program.getIntermediate(lang), spirv, &opt);
                std::printf("%s: OK (%zu words SPIR-V)\n", argv[2], spirv.size());
                ok = true;
            }
        }
    }
    FinalizeProcess();
    return ok ? 0 : 1;
}
