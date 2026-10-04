//============================================================================================================================================
//                                                    PROJECTOPENINGWINDOWS.CPP
//============================================================================================================================================
// 📦 Real Win32/DX11 browser smoke: read back the production card and verify the child-ready named event.

#include "../../Frontier/Engine/Host/ProjectOpeningSequence.h"
#include <windows.h>
#include <cassert>
#include <cstdio>

int main(int Count, char** Arguments)
{
    assert(Count == 2);
    char Name[128]{};
    std::snprintf(Name, sizeof(Name), "Local\\FrontierOpeningProof-%lu", GetCurrentProcessId());
    HANDLE Event = CreateEventA(nullptr, TRUE, FALSE, Name);
    assert(Event && WaitForSingleObject(Event, 0) == WAIT_TIMEOUT);
    char Program[] = "Frontier", Flag[] = "--launcher-event";
    char* ReadyArguments[] = {Program, Flag, Name};
    Frontier::CompleteProjectOpening(3, ReadyArguments);
    assert(WaitForSingleObject(Event, 0) == WAIT_OBJECT_0);
    CloseHandle(Event);
    const int Result = Frontier::RunProjectBrowser(Arguments[1]);
    if (!Result) std::puts("PASS real Win32 window, DX11 ImGui readback and named ready-event signal");
    return Result;
}
