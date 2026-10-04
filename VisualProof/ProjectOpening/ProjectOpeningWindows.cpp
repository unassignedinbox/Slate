//============================================================================================================================================
//                                                         PROJECTOPENINGWINDOWS.CPP
//============================================================================================================================================
// 📦 Real Win32/DX11 browser smoke: read back the production card and verify the child-ready named event.

#include "../../Frontier/Engine/Host/ProjectOpeningSequence.h"
#include <windows.h>
#include <cassert>
#include <cstdio>
#include <fstream>
#include "../../Frontier/Engine/Host/ProjectPreviewCodec.h"

int main(int Count, char **Arguments)
{
    assert(Count == 2);
    const HRESULT Apartment = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    assert(SUCCEEDED(Apartment));
    Frontier::ProjectPreviewPixels Pixels;
    std::filesystem::path          Source;
    std::string                    Refusal;
    assert(Frontier::FindProjectPreview("Frontier/Projects/Project-Drive/ProjectDrive.frontier", Source, Refusal));
    assert(Frontier::DecodeProjectPreview(Source, Pixels));
    assert(Pixels.Width == 480 && Pixels.Height == 270 && Pixels.Pixels.size() == 480u * 270u * 4u);
    assert(Frontier::FindProjectPreview("Frontier/Projects/Project-Zero/ProjectZero.frontier", Source, Refusal));
    assert(Frontier::DecodeProjectPreview(Source, Pixels));
    assert(Pixels.Width == 384 && Pixels.Height == 288 && Pixels.Pixels.size() == 384u * 288u * 4u);
    const auto Scratch = std::filesystem::path(Arguments[1]).parent_path() / std::filesystem::path(u8"Preview images with spaces é");
    std::filesystem::create_directories(Scratch);
    const auto UnicodeImage = Scratch / std::filesystem::path(u8"任意の名前.PNG");
    std::filesystem::copy_file(Source, UnicodeImage, std::filesystem::copy_options::overwrite_existing);
    assert(Frontier::DecodeProjectPreview(UnicodeImage, Pixels));
    const auto Invalid = Scratch / "Corrupt.png";
    std::ofstream(Invalid) << "not a PNG";
    assert(!Frontier::DecodeProjectPreview(Invalid, Pixels) && !Pixels.Refusal.empty() && Pixels.Width == 0);
    std::filesystem::resize_file(Invalid, 32u * 1024u * 1024u + 1u);
    assert(!Frontier::DecodeProjectPreview(Invalid, Pixels) && Pixels.Refusal.find("32 MiB") != std::string::npos);
    std::filesystem::remove_all(Scratch);
    assert(!Frontier::DecodeProjectPreview(Invalid, Pixels) && Pixels.Pixels.empty());
    CoUninitialize();
    std::puts("PASS native WIC: real project PNGs, aspect-preserving bounds, Unicode filenames, corrupt/missing/oversized refusals");
    char Name[128]{};
    std::snprintf(Name, sizeof(Name), "Local\\FrontierOpeningProof-%lu", GetCurrentProcessId());
    HANDLE Event = CreateEventA(nullptr, TRUE, FALSE, Name);
    assert(Event && WaitForSingleObject(Event, 0) == WAIT_TIMEOUT);
    char  Program[] = "Frontier", Flag[] = "--launcher-event";
    char *ReadyArguments[] = {Program, Flag, Name};
    Frontier::CompleteProjectOpening(3, ReadyArguments);
    assert(WaitForSingleObject(Event, 0) == WAIT_OBJECT_0);
    CloseHandle(Event);
    const int Result = Frontier::RunProjectBrowser(Arguments[1]);
    if (!Result)
        std::puts("PASS real Win32 window, DX11 ImGui readback and named ready-event signal");
    return Result;
}
