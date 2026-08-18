#============================================================================================================================================
#                                                             RUNSYMBOLINDEX.PY
#============================================================================================================================================
# 🧩 Provides python function to execute the Slate symbol indexer tool.

import os
import sys

#------------------------------------------------------------------------------------------------------------------------
#                                                        SYMBOL INDEX EXECUTION
#------------------------------------------------------------------------------------------------------------------------

def RunSymbolIndex(Command="build", Target=None, Root="Engine", NoCallSites=False, All=False):
    """Executes C:\\Users\\OS\\Documents\\Slate\\Tools\\SymbolIndex.py with specified options."""
    ToolsPath = r"C:\Users\OS\Documents\Slate\Tools\SymbolIndex.py"
    if not os.path.isfile(ToolsPath):
        print("🔴 SymbolIndex.py not found at {0}".format(ToolsPath))
        return 2

    sys.path.insert(0, os.path.dirname(ToolsPath))
    import SymbolIndex

    Arguments = ["--root", Root]
    if NoCallSites:
        Arguments.append("--no-call-sites")
    Arguments.append(Command)

    if Target:
        Arguments.append(Target)

    if All and Command == "find":
        Arguments.append("--all")

    return SymbolIndex.Main(Arguments)


if __name__ == "__main__":
    sys.exit(RunSymbolIndex(*sys.argv[1:]))
