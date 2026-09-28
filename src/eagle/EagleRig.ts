import * as THREE from 'three';

/**
 * Interface representing the complete articulated skeletal node references for the Eagle.
 */
export interface EagleRigNodes {
  root: THREE.Group;
  spine: THREE.Group;
  chest: THREE.Group;
  neckBase: THREE.Group;
  neckMid: THREE.Group;
  neckUpper: THREE.Group;
  head: THREE.Group;
  beakUpper: THREE.Group;
  beakLower: THREE.Group;
  throat: THREE.Group;
  eyeL: THREE.Group;
  eyeR: THREE.Group;
  nictitatingL: THREE.Mesh;
  nictitatingR: THREE.Mesh;

  // Left Wing
  shoulderL: THREE.Group;
  humerusL: THREE.Group;
  elbowL: THREE.Group;
  forearmL: THREE.Group;
  wristL: THREE.Group;
  manusL: THREE.Group;
  alulaL: THREE.Group;
  primariesL: THREE.Group[];
  secondariesL: THREE.Group[];

  // Right Wing
  shoulderR: THREE.Group;
  humerusR: THREE.Group;
  elbowR: THREE.Group;
  forearmR: THREE.Group;
  wristR: THREE.Group;
  manusR: THREE.Group;
  alulaR: THREE.Group;
  primariesR: THREE.Group[];
  secondariesR: THREE.Group[];

  // Tail
  tailJoint: THREE.Group;
  retrices: THREE.Group[];

  // Left Leg
  hipL: THREE.Group;
  thighL: THREE.Group;
  kneeL: THREE.Group;
  shankL: THREE.Group;
  ankleL: THREE.Group;
  tarsusL: THREE.Group;
  footL: THREE.Group;
  halluxL: THREE.Group;
  innerToeL: THREE.Group;
  midToeL: THREE.Group;
  outerToeL: THREE.Group;

  // Right Leg
  hipR: THREE.Group;
  thighR: THREE.Group;
  kneeR: THREE.Group;
  shankR: THREE.Group;
  ankleR: THREE.Group;
  tarsusR: THREE.Group;
  footR: THREE.Group;
  halluxR: THREE.Group;
  innerToeR: THREE.Group;
  midToeR: THREE.Group;
  outerToeR: THREE.Group;

  // Visual Groups for layer toggling
  bodyMeshGroup: THREE.Group;
  skeletonGroup: THREE.Group;
  wingsMeshGroup: THREE.Group;
  feathersGroup: THREE.Group;
}
