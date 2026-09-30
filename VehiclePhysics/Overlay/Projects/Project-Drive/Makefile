# ============================================================================================================================================
#  Projects/Project-Drive/Makefile — standalone VehicleSolver telemetry only.
# ============================================================================================================================================
#  Frontier.exe owns every renderer. This makefile intentionally has no scene renderer, editor imitation, or image capture
#  target. It only runs the real Project-Drive vehicle simulation and writes telemetry for analysis or native replay.
#
#      make telemetry   -> bin/DriveTelemetry -> Diagnostics/{telemetry.csv,timing.log,run.log}
#
#  Explicit file lists only — never glob Source/.

CXX       := g++
CXXFLAGS  := -std=c++20 -O2 -Wall -Wextra
VEHICLE   := ../../Engine/PhysicalDynamics/Vehicle
BIN       := bin
DIAG      := Diagnostics

VEHICLE_SRCS := \
	$(VEHICLE)/VehicleSolver.cpp \
	$(VEHICLE)/VehicleGeometry.cpp \
	$(VEHICLE)/Aerodynamics.cpp \
	$(VEHICLE)/XPBDSoftTyre.cpp \
	$(VEHICLE)/PacejkaMagicFormula.cpp \
	$(VEHICLE)/TyreSlipDynamics.cpp \
	$(VEHICLE)/Drivetrain.cpp

.PHONY: telemetry run clean
telemetry: $(BIN)/DriveTelemetry

$(BIN)/DriveTelemetry: Source/DriveTelemetry.cpp Source/DriveCourse.h $(VEHICLE_SRCS) | $(BIN)
	$(CXX) $(CXXFLAGS) -I$(VEHICLE) -ISource Source/DriveTelemetry.cpp $(VEHICLE_SRCS) -o $@

$(BIN) $(DIAG):
	@mkdir -p $@

run: telemetry | $(DIAG)
	./$(BIN)/DriveTelemetry $(DIAG)

clean:
	rm -rf $(BIN)
