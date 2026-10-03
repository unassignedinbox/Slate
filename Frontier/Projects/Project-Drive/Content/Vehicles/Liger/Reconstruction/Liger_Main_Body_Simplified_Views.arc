# Native SolidArc view script. Run after Liger_Main_Body_Simplified.arc, not as a replacement for the geometry.
# Vehicle front is +X; symmetry plane is Y=0. All four images retain actual CAD boundary edges.
show cages off
show iso off
show edges on
show shading plastic
view front
view orbit 55 23
view persp
view fit
view dolly 1.5
render Liger_Simplified_Front_Quarter --size=1600x1000
render sheet 0
view front
view orbit -55 23
view persp
view fit
view dolly 1.5
render Liger_Simplified_Rear_Quarter --size=1600x1000
render sheet 1
view front
view fit
view dolly 1.5
render Liger_Simplified_Side --size=1600x1000
render sheet 2
view top
view fit
view dolly 1.5
render Liger_Simplified_Top --size=1600x1000
render sheet 3
render sheet finalize Liger_Simplified_Four_Views
