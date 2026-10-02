# SolidArc native document v1
# SourceCAD 3D Practice 4. World axes: +X right, +Y depth, +Z up.

reset
box (0,0,0) 5 4 6 --name=Blank
fillet Blank 2 --edges=5 --name=Part
view front
view fit
render SourceCAD_Fillet_ZUp --size=960x720
polyline (-0.5,4.5,-0.5) (3.5417,4.5,-0.5) (-0.5,4.5,4.35) --closed --name=W0
polyline (-0.5,1.3,-0.5) (-0.4583,1.3,-0.5) (-0.5,1.3,-0.45) --closed --name=W1
loft W0 W1 --name=Wedge
delete W0 W1
boolean subtract Part -- Wedge --name=Part
view front
view persp
view orbit 55 18
view fit
render SourceCAD_Final_ZUp --size=960x720
