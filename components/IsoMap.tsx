/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Canvas, useFrame, useThree, ThreeElements } from '@react-three/fiber';
import { MapControls, Environment, SoftShadows, Instance, Instances, Float, useTexture, Outlines, OrthographicCamera, Html } from '@react-three/drei';
import * as THREE from 'three';
import { MathUtils } from 'three';
import { Grid, BuildingType, TileData, CityStats, BuildingCategory, FloatingTextData } from '../types';
import { GRID_SIZE, CHUNK_SIZE, BUILDINGS } from '../constants';

// Fix for TypeScript not recognizing R3F elements in JSX
declare global {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}

// --- Constants & Helpers ---
const getSnappedCameraAngle = (camera: THREE.Camera): number => {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const angle = Math.atan2(dir.x, dir.z); // Direction the camera is looking
  const faceAngle = angle + Math.PI; // Face opposite to looking direction (facing player)
  const snapped = Math.round(faceAngle / (Math.PI / 2)) * (Math.PI / 2);
  return snapped;
};

const WORLD_OFFSET = GRID_SIZE / 2 - 0.5;
const gridToWorld = (x: number, y: number) => [x - WORLD_OFFSET, 0, y - WORLD_OFFSET] as [number, number, number];

// Deterministic random based on coordinates
const getHash = (x: number, y: number) => Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
const getRandomRange = (min: number, max: number) => Math.random() * (max - min) + min;

// Shared Geometries
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const cylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
const coneGeo = new THREE.ConeGeometry(1, 1, 4);
const sphereGeo = new THREE.SphereGeometry(1, 8, 8);

// --- 1. Advanced Procedural Buildings ---

// FIX: Wrap component in React.memo to ensure TypeScript recognizes it as a component that accepts a 'key' prop.
const WindowBlock = React.memo(({ position, scale }: { position: [number, number, number], scale: [number, number, number] }) => (
  <mesh geometry={boxGeo} position={position} scale={scale}>
    <meshStandardMaterial color="#bfdbfe" emissive="#fef08a" emissiveIntensity={0.5} roughness={0.1} metalness={0.8} />
  </mesh>
));

const SmokeStack = ({ position }: { position: [number, number, number] }) => {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (ref.current) {
      ref.current.children.forEach((child, i) => {
        const cloud = child as THREE.Mesh;
        cloud.position.y += 0.01 + i * 0.005;
        cloud.scale.addScalar(0.005);
        
        const material = cloud.material as THREE.MeshStandardMaterial;
        if (material) {
          material.opacity -= 0.005;
          if (cloud.position.y > 1.5) {
            cloud.position.y = 0;
            cloud.scale.setScalar(0.1 + Math.random() * 0.1);
            material.opacity = 0.6;
          }
        }
      });
    }
  });

  return (
    <group position={position}>
      <mesh geometry={cylinderGeo} castShadow receiveShadow position={[0, 0.5, 0]} scale={[0.2, 1, 0.2]}>
        <meshStandardMaterial color="#4b5563" />
      </mesh>
      <group ref={ref} position={[0, 1, 0]}>
        {[0, 1, 2].map(i => (
          <mesh key={i} geometry={sphereGeo} position={[Math.random()*0.1, i*0.4, Math.random()*0.1]} scale={0.2}>
            <meshStandardMaterial color="#d1d5db" transparent opacity={0.6} flatShading />
          </mesh>
        ))}
      </group>
    </group>
  );
};

interface BuildingMeshProps {
  type: BuildingType;
  baseColor: string;
  x: number;
  y: number;
  opacity?: number;
  transparent?: boolean;
  rotation?: number;
}

const ProceduralBuilding = React.memo(({ type, baseColor, x, y, opacity = 1, transparent = false, rotation = 0 }: BuildingMeshProps) => {
  const hash = getHash(x, y);
  const variant = Math.floor(hash * 100); // 0-99
  
  // No random color variation or rotation, ensure predictability for player
  const colorStr = baseColor;

  const accentColorStr = useMemo(() => {
    const c = new THREE.Color(colorStr);
    return '#' + c.multiplyScalar(0.7).getHexString();
  }, [colorStr]);

  const roofColorStr = useMemo(() => {
    const c = new THREE.Color(colorStr);
    return '#' + c.multiplyScalar(0.5).offsetHSL(0,0,-0.1).getHexString();
  }, [colorStr]);

  const TreeGroup = ({ i, pos, scale }: { i: number, pos: number[], scale: number }) => {
    const treeColor = useMemo(() => {
      const c = new THREE.Color("#166534");
      c.offsetHSL(0, 0, getHash(x,y+i)*0.2);
      return '#' + c.getHexString();
    }, [i]);
    return (
      <group position={[pos[0], 0, pos[1]]} scale={scale} rotation={[0, getHash(i,x)*Math.PI, 0]}>
          <mesh castShadow={false} receiveShadow={false} geometry={cylinderGeo} position={[0, 0.15, 0]} scale={[0.1, 0.3, 0.1]}>
             <meshStandardMaterial color="#78350f" />
          </mesh>
          <mesh castShadow={false} receiveShadow={false} geometry={coneGeo} position={[0, 0.4, 0]} scale={[0.4, 0.5, 0.4]}>
             <meshStandardMaterial color={treeColor} flatShading />
          </mesh>
          <mesh castShadow={false} receiveShadow={false} geometry={coneGeo} position={[0, 0.65, 0]} scale={[0.3, 0.4, 0.3]}>
             <meshStandardMaterial color={treeColor} flatShading />
          </mesh>
      </group>
    );
  };

  const commonProps = { castShadow: false, receiveShadow: false };
  const getMatProps = (c: string) => ({ color: c, flatShading: true, opacity, transparent, roughness: 0.8 });

  // Buildings are built assuming y=0 is ground level within their group
  // Adjust vertical position to sit on top of ground tile (approx -0.3)
  const yOffset = -0.3;
  const groupRef = useRef<THREE.Group>(null);

  return (
    <group ref={groupRef} position={[0, yOffset, 0]} rotation={[0, rotation, 0]}>
      {(() => {
        switch (type) {
                    case BuildingType.Mall:
            // High-End Modern Mega Shopping Mall (Молл) - 3x3 footprint
            return (
              <>
                {/* Decorative Plaza Foundation slab with patterned borders */}
                <mesh position={[0, 0.005, 0]} scale={[2.9, 0.01, 2.9]} geometry={boxGeo}>
                  <meshStandardMaterial color="#cbd5e1" />
                </mesh>

                {/* Main Ground Atrium floor block */}
                <mesh {...commonProps} geometry={boxGeo} position={[0, 0.3, -0.15]} scale={[2.7, 0.58, 2.5]}>
                  <meshStandardMaterial {...getMatProps(colorStr)} />
                </mesh>

                {/* Second Atrium retail level block */}
                <mesh {...commonProps} geometry={boxGeo} position={[0, 0.85, -0.2]} scale={[2.5, 0.52, 2.2]}>
                  <meshStandardMaterial {...getMatProps(accentColorStr)} />
                </mesh>

                {/* Third level / Cinema block in the back */}
                <mesh {...commonProps} geometry={boxGeo} position={[-0.45, 1.35, -0.5]} scale={[1.4, 0.48, 1.4]}>
                  <meshStandardMaterial {...getMatProps(roofColorStr)} />
                </mesh>

                {/* Central Futuristic Glass Dome Atrium Skylight */}
                <mesh {...commonProps} geometry={cylinderGeo} position={[0.45, 1.15, -0.2]} scale={[0.8, 0.16, 0.8]}>
                  <meshStandardMaterial color="#38bdf8" transparent opacity={0.6} roughness={0.1} />
                </mesh>
                <mesh {...commonProps} geometry={sphereGeo} position={[0.45, 1.2, -0.2]} scale={[0.72, 0.35, 0.72]}>
                  <meshStandardMaterial color="#e0f2fe" transparent opacity={0.5} roughness={0.1} />
                </mesh>

                {/* Massive glass facade archways around front (Main Entrance facing +Z) */}
                <WindowBlock position={[0.7, 0.4, 1.01]} scale={[0.8, 0.42, 0.02]} />
                <WindowBlock position={[-0.7, 0.4, 1.01]} scale={[0.8, 0.42, 0.02]} />
                <WindowBlock position={[1.26, 0.4, 0.3]} scale={[0.02, 0.42, 1.0]} />
                <WindowBlock position={[-1.26, 0.4, 0.3]} scale={[0.02, 0.42, 1.0]} />
                <WindowBlock position={[1.16, 0.85, 0.4]} scale={[0.02, 0.38, 0.8]} />
                <WindowBlock position={[-1.16, 0.85, 0.4]} scale={[0.02, 0.38, 0.8]} />

                {/* Center Glass Revolving Main Entry door */}
                <mesh {...commonProps} geometry={cylinderGeo} position={[0, 0.22, 1.02]} scale={[0.35, 0.42, 0.35]}>
                  <meshStandardMaterial color="#0f172a" transparent opacity={0.7} roughness={0.1} />
                </mesh>
                <mesh {...commonProps} geometry={boxGeo} position={[0, 0.43, 1.02]} scale={[0.5, 0.04, 0.5]}>
                  <meshStandardMaterial color="#475569" metalness={0.9} roughness={0.1} />
                </mesh>

                {/* Giant Neon Billboard Tower sign on front corner */}
                <group position={[-1.1, 0, 1.1]}>
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 0.65, 0]} scale={[0.1, 1.3, 0.1]}>
                    <meshStandardMaterial color="#1e293b" />
                  </mesh>
                  {/* Two diagonal screens */}
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 1.1, 0]} scale={[0.42, 0.35, 0.42]} rotation={[0, Math.PI / 4, 0]}>
                    <meshStandardMaterial color="#0f172a" />
                  </mesh>
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 1.1, 0.01]} scale={[0.38, 0.3, 0.43]} rotation={[0, Math.PI / 4, 0]}>
                    <meshStandardMaterial color="#fca5a5" emissive="#b91c1c" emissiveIntensity={0.8} />
                  </mesh>
                </group>

                {/* Elegant active Water Fountain in front of Mall entrance */}
                <group position={[0, 0, 1.25]}>
                  {/* Fountain stone base basin */}
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 0.04, 0]} scale={[0.52, 0.08, 0.52]}>
                    <meshStandardMaterial color="#94a3b8" />
                  </mesh>
                  {/* Water surface inside basin */}
                  <mesh receiveShadow position={[0, 0.07, 0]} scale={[0.42, 0.02, 0.42]} geometry={cylinderGeo}>
                    <meshStandardMaterial color="#0ea5e9" opacity={0.85} transparent roughness={0.1} />
                  </mesh>
                  {/* Center tiered water spray spout */}
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 0.12, 0]} scale={[0.15, 0.16, 0.15]}>
                    <meshStandardMaterial color="#e2e8f0" />
                  </mesh>
                  {/* Splashing water core */}
                  <mesh {...commonProps} geometry={sphereGeo} position={[0, 0.22, 0]} scale={[0.12, 0.25, 0.12]}>
                    <meshStandardMaterial color="#bae6fd" opacity={0.9} transparent roughness={0.1} />
                  </mesh>
                </group>

                {/* Decorative plaza green planters with bushes */}
                <group position={[0.7, 0, 1.18]}>
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 0.06, 0]} scale={[0.4, 0.12, 0.22]}>
                    <meshStandardMaterial color="#475569" />
                  </mesh>
                  <mesh {...commonProps} geometry={sphereGeo} position={[-0.08, 0.16, 0]} scale={[0.14, 0.14, 0.14]}>
                    <meshStandardMaterial color="#16a34a" flatShading />
                  </mesh>
                  <mesh {...commonProps} geometry={sphereGeo} position={[0.08, 0.16, 0]} scale={[0.16, 0.16, 0.16]}>
                    <meshStandardMaterial color="#15803d" flatShading />
                  </mesh>
                </group>

                <group position={[-0.7, 0, 1.18]}>
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 0.06, 0]} scale={[0.4, 0.12, 0.22]}>
                    <meshStandardMaterial color="#475569" />
                  </mesh>
                  <mesh {...commonProps} geometry={sphereGeo} position={[-0.08, 0.16, 0]} scale={[0.16, 0.16, 0.16]}>
                    <meshStandardMaterial color="#16a34a" flatShading />
                  </mesh>
                  <mesh {...commonProps} geometry={sphereGeo} position={[0.08, 0.16, 0]} scale={[0.14, 0.14, 0.14]}>
                    <meshStandardMaterial color="#15803d" flatShading />
                  </mesh>
                </group>
              </>
            );

          case BuildingType.FinancialCenter:
            // High-Tech Financial Center Headquarters Tower (Финансовый центр) - 3x4 footprint
            return (
              <>
                {/* Landscaped Granite Corporate Plaza Slab */}
                <mesh position={[0, 0.005, 0]} scale={[2.9, 0.01, 3.9]} geometry={boxGeo}>
                  <meshStandardMaterial color="#1e293b" />
                </mesh>

                {/* Tower Plaza Podium (Base Wing) */}
                <mesh {...commonProps} geometry={boxGeo} position={[0, 0.28, 0]} scale={[2.7, 0.55, 3.7]}>
                  <meshStandardMaterial {...getMatProps(accentColorStr)} />
                </mesh>

                {/* Massive Main Financial Skyscraper Tower (Central Spire Building) */}
                <mesh {...commonProps} geometry={boxGeo} position={[0.3, 2.35, -0.25]} scale={[1.8, 3.6, 2.6]}>
                  <meshStandardMaterial {...getMatProps(colorStr)} />
                </mesh>

                {/* Attached Architectural Glass Wing */}
                <mesh {...commonProps} geometry={boxGeo} position={[-0.85, 1.45, -0.25]} scale={[0.65, 1.8, 2.6]}>
                  <meshStandardMaterial color="#0284c7" transparent opacity={0.65} roughness={0.1} metalness={0.9} />
                </mesh>

                {/* High-Contrast Exterior Structural Steel Column Ribs (Vertical lines) */}
                <mesh {...commonProps} geometry={boxGeo} position={[-0.56, 2.35, 1.06]} scale={[0.08, 3.6, 0.04]}>
                  <meshStandardMaterial color="#e2e8f0" />
                </mesh>
                <mesh {...commonProps} geometry={boxGeo} position={[1.16, 2.35, 1.06]} scale={[0.08, 3.6, 0.04]}>
                  <meshStandardMaterial color="#e2e8f0" />
                </mesh>
                <mesh {...commonProps} geometry={boxGeo} position={[0.3, 2.35, 1.06]} scale={[0.08, 3.6, 0.04]}>
                  <meshStandardMaterial color="#e2e8f0" />
                </mesh>

                {/* Massive corporate glass penthouse atrium at the very top */}
                <mesh {...commonProps} geometry={boxGeo} position={[0.3, 4.35, -0.25]} scale={[1.6, 0.4, 2.4]}>
                  <meshStandardMaterial color="#38bdf8" transparent opacity={0.65} roughness={0.15} />
                </mesh>
                <mesh {...commonProps} geometry={boxGeo} position={[0.3, 4.56, -0.25]} scale={[1.7, 0.04, 2.5]}>
                  <meshStandardMaterial color="#0f172a" />
                </mesh>

                {/* Rooftop Corporate Communications Antenna / Spire */}
                <mesh {...commonProps} geometry={cylinderGeo} position={[0.3, 5.0, -0.25]} scale={[0.05, 0.9, 0.05]}>
                  <meshStandardMaterial color="#cbd5e1" metalness={0.9} roughness={0.1} />
                </mesh>
                <mesh {...commonProps} geometry={sphereGeo} position={[0.3, 5.48, -0.25]} scale={[0.08, 0.08, 0.08]}>
                  <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={0.8} />
                </mesh>

                {/* Window Blocks Grid overlay on Main Tower faces */}
                {Array.from({ length: 9 }).map((_, i) => (
                  <WindowBlock key={`front-w-${i}`} position={[0.3, 0.75 + i * 0.38, 1.062]} scale={[1.5, 0.16, 0.03]} />
                ))}
                {Array.from({ length: 9 }).map((_, i) => (
                  <WindowBlock key={`right-w-${i}`} position={[1.21, 0.75 + i * 0.38, -0.25]} scale={[0.03, 0.16, 2.1]} />
                ))}

                {/* Helicopter Pad on the Left Glass level roof */}
                <group position={[-0.85, 2.36, -0.25]}>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 0.005, 0]} scale={[0.54, 0.02, 0.54]}>
                    <meshStandardMaterial color="#475569" roughness={0.95} />
                  </mesh>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 0.008, 0]} scale={[0.48, 0.019, 0.48]}>
                    <meshStandardMaterial color="#eab308" />
                  </mesh>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 0.01, 0]} scale={[0.42, 0.018, 0.42]}>
                    <meshStandardMaterial color="#475569" />
                  </mesh>
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 0.012, 0]} scale={[0.04, 0.016, 0.16]}>
                    <meshStandardMaterial color="#ffffff" />
                  </mesh>
                  <mesh {...commonProps} geometry={boxGeo} position={[-0.06, 0.012, 0]} scale={[0.04, 0.016, 0.04]}>
                    <meshStandardMaterial color="#ffffff" />
                  </mesh>
                  <mesh {...commonProps} geometry={boxGeo} position={[0.06, 0.012, 0]} scale={[0.04, 0.016, 0.04]}>
                    <meshStandardMaterial color="#ffffff" />
                  </mesh>
                </group>

                {/* Plaza double door entrances */}
                <mesh {...commonProps} geometry={boxGeo} position={[0, 0.22, 1.86]} scale={[0.45, 0.38, 0.02]}>
                  <meshStandardMaterial color="#1f2937" roughness={0.1} />
                </mesh>

                {/* Multi-story curtain-glass on left entrance block */}
                <WindowBlock position={[0, 0.28, 1.854]} scale={[1.2, 0.3, 0.02]} />

                {/* Decorative Modern Landmark Obelisk / Art Sculpture in front of highrise */}
                <group position={[-0.9, 0, 1.3]}>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 0.22, 0]} scale={[0.1, 0.44, 0.1]} rotation={[0.2, 0, 0.25]}>
                    <meshStandardMaterial color="#cbd5e1" metalness={0.9} roughness={0.1} />
                  </mesh>
                  <mesh {...commonProps} geometry={sphereGeo} position={[0.05, 0.42, 0.05]} scale={[0.1, 0.1, 0.1]}>
                    <meshStandardMaterial color="#38bdf8" roughness={0.1} metalness={0.9} />
                  </mesh>
                </group>

                {/* Corporate flagpoles in plaza */}
                <group position={[1.0, 0, 1.5]}>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 0.35, 0]} scale={[0.02, 0.7, 0.02]}>
                    <meshStandardMaterial color="#64748b" />
                  </mesh>
                  <mesh {...commonProps} geometry={boxGeo} position={[0.08, 0.62, 0]} scale={[0.16, 0.1, 0.01]}>
                    <meshStandardMaterial color="#3b82f6" />
                  </mesh>
                </group>
                <group position={[1.2, 0, 1.3]}>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 0.35, 0]} scale={[0.02, 0.7, 0.02]}>
                    <meshStandardMaterial color="#64748b" />
                  </mesh>
                  <mesh {...commonProps} geometry={boxGeo} position={[0.08, 0.62, 0]} scale={[0.16, 0.1, 0.01]}>
                    <meshStandardMaterial color="#ef4444" />
                  </mesh>
                </group>
              </>
            );

case BuildingType.ChemicalPlant:
            // High-Tech Industrial Petroleum & Chemical Complex (Химзавод) - 3x3 footprint
            return (
              <>
                {/* Granular Concrete containment area flat floor */}
                <mesh position={[0, 0.005, 0]} scale={[2.9, 0.01, 2.9]} geometry={boxGeo}>
                  <meshStandardMaterial color="#475569" />
                </mesh>

                {/* Central Chemical Reactor Atrium block */}
                <mesh {...commonProps} geometry={boxGeo} position={[0, 0.4, -0.3]} scale={[1.8, 0.8, 1.4]}>
                  <meshStandardMaterial {...getMatProps(colorStr)} />
                </mesh>

                {/* Massive distillation column distillation tower */}
                <mesh {...commonProps} geometry={cylinderGeo} position={[0.7, 1.1, -0.6]} scale={[0.42, 2.2, 0.42]}>
                  <meshStandardMaterial color="#cbd5e1" metalness={0.85} roughness={0.15} />
                </mesh>
                {/* Red warnings lights on top of tall tower */}
                <mesh {...commonProps} geometry={sphereGeo} position={[0.7, 2.22, -0.6]} scale={[0.1, 0.1, 0.1]}>
                  <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={0.8} />
                </mesh>

                {/* Spherical Gas Storage Tank 1 (White pressure sphere) */}
                <group position={[-0.8, 0, 0.5]}>
                  {/* Curved support struts */}
                  <mesh {...commonProps} geometry={cylinderGeo} position={[-0.3, 0.22, -0.3]} scale={[0.03, 0.44, 0.03]}>
                    <meshStandardMaterial color="#64748b" />
                  </mesh>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0.3, 0.22, -0.3]} scale={[0.03, 0.44, 0.03]}>
                    <meshStandardMaterial color="#64748b" />
                  </mesh>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[-0.3, 0.22, 0.3]} scale={[0.03, 0.44, 0.03]}>
                    <meshStandardMaterial color="#64748b" />
                  </mesh>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0.3, 0.22, 0.3]} scale={[0.03, 0.44, 0.03]}>
                    <meshStandardMaterial color="#64748b" />
                  </mesh>
                  {/* Sphere */}
                  <mesh {...commonProps} geometry={sphereGeo} position={[0, 0.55, 0]} scale={[0.55, 0.55, 0.55]}>
                    <meshStandardMaterial color="#f1f5f9" metalness={0.65} roughness={0.1} />
                  </mesh>
                </group>

                {/* Horizontal storage tank vessel */}
                <group position={[0.8, 0, 0.4]}>
                  {/* Saddles */}
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 0.08, -0.25]} scale={[0.5, 0.16, 0.12]}>
                    <meshStandardMaterial color="#1e293b" />
                  </mesh>
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 0.08, 0.25]} scale={[0.5, 0.16, 0.12]}>
                    <meshStandardMaterial color="#1e293b" />
                  </mesh>
                  {/* Horizontal cylinder */}
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 0.36, 0]} scale={[0.34, 0.8, 0.34]} rotation={[Math.PI / 2, 0, 0]}>
                    <meshStandardMaterial color="#94a3b8" metalness={0.8} />
                  </mesh>
                  <mesh {...commonProps} geometry={sphereGeo} position={[0, 0.36, -0.4]} scale={[0.34, 0.34, 0.34]}>
                    <meshStandardMaterial color="#94a3b8" metalness={0.8} />
                  </mesh>
                  <mesh {...commonProps} geometry={sphereGeo} position={[0, 0.36, 0.4]} scale={[0.34, 0.34, 0.34]}>
                    <meshStandardMaterial color="#94a3b8" metalness={0.8} />
                  </mesh>
                </group>

                {/* Overpass Pipeline Rack System with multiple parallel tubes */}
                <group position={[-0.4, 0, -0.6]}>
                  {/* Frame */}
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 0.4, 0]} scale={[0.06, 0.8, 0.06]}>
                    <meshStandardMaterial color="#64748b" />
                  </mesh>
                  <mesh {...commonProps} geometry={boxGeo} position={[0.6, 0.4, 0]} scale={[0.06, 0.8, 0.06]}>
                    <meshStandardMaterial color="#64748b" />
                  </mesh>
                  <mesh {...commonProps} geometry={boxGeo} position={[0.3, 0.76, 0]} scale={[0.66, 0.06, 0.06]}>
                    <meshStandardMaterial color="#64748b" />
                  </mesh>
                  {/* Horizontal pipes running through rack */}
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0.3, 0.84, -0.05]} scale={[0.04, 0.8, 0.04]} rotation={[0, 0, Math.PI / 2]}>
                    <meshStandardMaterial color="#ef4444" metalness={0.8} />
                  </mesh>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0.3, 0.84, 0.05]} scale={[0.04, 0.8, 0.04]} rotation={[0, 0, Math.PI / 2]}>
                    <meshStandardMaterial color="#3b82f6" metalness={0.8} />
                  </mesh>
                </group>

                {/* Safety Flare / exhaust tower with flame glow */}
                <group position={[-1.1, 0, -1.0]}>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 0.8, 0]} scale={[0.05, 1.6, 0.05]}>
                    <meshStandardMaterial color="#1e293b" />
                  </mesh>
                  {/* Flare collector tip */}
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 1.62, 0]} scale={[0.1, 0.06, 0.1]}>
                    <meshStandardMaterial color="#ef4444" />
                  </mesh>
                  {/* Flame flare particle sphere */}
                  <mesh {...commonProps} geometry={sphereGeo} position={[0, 1.76, 0]} scale={[0.16, 0.28, 0.16]}>
                    <meshStandardMaterial color="#f97316" emissive="#ea580c" emissiveIntensity={0.9} transparent opacity={0.85} />
                  </mesh>
                </group>

                {/* Animated SmokeStacks venting heavily */}
                <SmokeStack position={[-0.5, 0.4, -0.6]} />
                <SmokeStack position={[0.1, 0.4, -0.6]} />
              </>
            );

          case BuildingType.HighTechFactory:
            // High-Tech Cleanroom Laboratory & Nanotechnology Complex (Нанотеховский комплекс) - 4x4 footprint
            return (
              <>
                {/* Pristine Granite Ceramic Plaza Foundation */}
                <mesh position={[0, 0.005, 0]} scale={[3.9, 0.01, 3.9]} geometry={boxGeo}>
                  <meshStandardMaterial color="#0f172a" roughness={0.15} />
                </mesh>

                {/* Giant Central Cleanroom Bio-Dome Core */}
                <mesh {...commonProps} geometry={cylinderGeo} position={[0, 0.55, 0]} scale={[1.4, 1.1, 1.4]}>
                  <meshStandardMaterial color="#0284c7" transparent opacity={0.4} roughness={0.05} metalness={0.9} />
                </mesh>
                {/* Inner reactor core glow sphere */}
                <mesh {...commonProps} geometry={sphereGeo} position={[0, 0.45, 0]} scale={[0.72, 0.9, 0.72]}>
                  <meshStandardMaterial color="#22d3ee" emissive="#06b6d4" emissiveIntensity={0.85} />
                </mesh>
                {/* Cleanroom core roof slab */}
                <mesh {...commonProps} geometry={cylinderGeo} position={[0, 1.12, 0]} scale={[1.42, 0.04, 1.42]}>
                  <meshStandardMaterial color="#cbd5e1" metalness={0.8} />
                </mesh>

                {/* Section B: Left Laboratory Wing */}
                <mesh {...commonProps} geometry={boxGeo} position={[-1.25, 0.4, -0.35]} scale={[1.0, 0.8, 1.9]}>
                  <meshStandardMaterial {...getMatProps(colorStr)} />
                </mesh>
                {/* Roof vents/fans for labs */}
                <mesh receiveShadow position={[-1.25, 0.805, -0.6]} scale={[0.42, 0.01, 0.42]} geometry={cylinderGeo}>
                  <meshStandardMaterial color="#475569" />
                </mesh>
                <mesh {...commonProps} geometry={cylinderGeo} position={[-1.25, 0.83, -0.6]} scale={[0.3, 0.05, 0.3]}>
                  <meshStandardMaterial color="#22c55e" emissive="#15803d" emissiveIntensity={0.6} />
                </mesh>

                {/* Section C: Right Laboratory Wing */}
                <mesh {...commonProps} geometry={boxGeo} position={[1.25, 0.4, -0.35]} scale={[1.0, 0.8, 1.9]}>
                  <meshStandardMaterial {...getMatProps(colorStr)} />
                </mesh>
                {/* Modern structural diagonal ribbons */}
                <mesh {...commonProps} geometry={boxGeo} position={[1.76, 0.4, -0.35]} scale={[0.02, 0.81, 0.06]} rotation={[0.2, 0, 0]}>
                  <meshStandardMaterial color="#38bdf8" />
                </mesh>
                <mesh {...commonProps} geometry={boxGeo} position={[1.76, 0.4, 0.35]} scale={[0.02, 0.81, 0.06]} rotation={[-0.2, 0, 0]}>
                  <meshStandardMaterial color="#38bdf8" />
                </mesh>

                {/* Rear administrative wing in grey scale */}
                <mesh {...commonProps} geometry={boxGeo} position={[0, 0.35, -1.35]} scale={[1.5, 0.7, 0.8]}>
                  <meshStandardMaterial {...getMatProps(accentColorStr)} />
                </mesh>

                {/* Advanced Telecommunications Spire on back corner */}
                <group position={[-1.3, 0, -1.4]}>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 0.8, 0]} scale={[0.04, 1.6, 0.04]}>
                    <meshStandardMaterial color="#94a3b8" metalness={0.9} />
                  </mesh>
                  {/* Multi-story dishes */}
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 1.1, 0]} scale={[0.26, 0.03, 0.26]} rotation={[0, 0, 0.4]}>
                    <meshStandardMaterial color="#cbd5e1" />
                  </mesh>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 1.4, 0]} scale={[0.18, 0.03, 0.18]} rotation={[0.4, 0, 0]}>
                    <meshStandardMaterial color="#cbd5e1" />
                  </mesh>
                  {/* Warning active beacon top */}
                  <mesh {...commonProps} geometry={sphereGeo} position={[0, 1.62, 0]} scale={[0.08, 0.08, 0.08]}>
                    <meshStandardMaterial color="#3b82f6" emissive="#3b82f6" emissiveIntensity={0.8} />
                  </mesh>
                </group>

                {/* Automated UAV/Drone Landing Delivery Pad */}
                <group position={[0, 0, 1.15]}>
                  {/* Pedestal platform */}
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 0.12, 0]} scale={[0.82, 0.24, 0.82]}>
                    <meshStandardMaterial color="#334155" />
                  </mesh>
                  {/* Glowing Landing Decal ring */}
                  <mesh receiveShadow position={[0, 0.245, 0]} scale={[0.7, 0.01, 0.7]} geometry={cylinderGeo}>
                    <meshStandardMaterial color="#22d3ee" emissive="#fbbf24" emissiveIntensity={0.5} />
                  </mesh>
                  {/* Inner dark center */}
                  <mesh receiveShadow position={[0, 0.248, 0]} scale={[0.6, 0.01, 0.6]} geometry={cylinderGeo}>
                    <meshStandardMaterial color="#1e293b" />
                  </mesh>
                  {/* Micro Drone parked on landing pad */}
                  <group position={[0, 0.28, 0]} scale={0.8}>
                    {/* Drone core */}
                    <mesh {...commonProps} geometry={sphereGeo} position={[0, 0.04, 0]} scale={[0.1, 0.08, 0.1]}>
                      <meshStandardMaterial color="#ffffff" metalness={0.9} roughness={0.1} />
                    </mesh>
                    {/* Arms */}
                    <mesh {...commonProps} geometry={boxGeo} position={[0, 0.04, 0]} scale={[0.3, 0.02, 0.03]} rotation={[0, Math.PI / 4, 0]}>
                      <meshStandardMaterial color="#334155" />
                    </mesh>
                    <mesh {...commonProps} geometry={boxGeo} position={[0, 0.04, 0]} scale={[0.3, 0.02, 0.03]} rotation={[0, -Math.PI / 4, 0]}>
                      <meshStandardMaterial color="#334155" />
                    </mesh>
                  </group>
                </group>

                {/* Energy solar tree tracker sculptures */}
                <group position={[-1.4, 0, 1.2]}>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 0.18, 0]} scale={[0.03, 0.36, 0.03]} rotation={[0.1, 0, 0.1]}>
                    <meshStandardMaterial color="#cbd5e1" />
                  </mesh>
                  {/* Solar collector wings */}
                  <mesh {...commonProps} geometry={boxGeo} position={[0.04, 0.35, 0.04]} scale={[0.22, 0.015, 0.22]} rotation={[0.4, 0, 0.4]}>
                    <meshStandardMaterial color="#3b82f6" metalness={0.8} roughness={0.1} />
                  </mesh>
                </group>

                <group position={[1.4, 0, 1.2]}>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 0.18, 0]} scale={[0.03, 0.36, 0.03]} rotation={[0.1, 0, -0.1]}>
                    <meshStandardMaterial color="#cbd5e1" />
                  </mesh>
                  {/* Solar collector wings */}
                  <mesh {...commonProps} geometry={boxGeo} position={[-0.04, 0.35, 0.04]} scale={[0.22, 0.015, 0.22]} rotation={[0.4, 0, -0.4]}>
                    <meshStandardMaterial color="#3b82f6" metalness={0.8} roughness={0.1} />
                  </mesh>
                </group>
              </>
            );

          case BuildingType.AquaPark:
            // High-End Aqua Park Water Swimming World (Аквапарк) - 3x3 footprint
            return (
              <>
                {/* Pristine tiled light sand beach patio board */}
                <mesh position={[0, 0.005, 0]} scale={[2.9, 0.01, 2.9]} geometry={boxGeo}>
                  <meshStandardMaterial color="#fef08a" roughness={0.6} />
                </mesh>

                {/* Sparkling Turquoise Swimming Pool and Wave basin */}
                <mesh position={[0, 0.01, 0.1]} scale={[2.6, 0.015, 2.1]} geometry={boxGeo}>
                  <meshStandardMaterial color="#06b6d4" roughness={0.15} metalness={0.8} transparent opacity={0.8} />
                </mesh>

                {/* High Tower building with slide launch platform */}
                <group position={[-0.9, 0, -1.0]}>
                  {/* Foundation Core columns */}
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 0.6, 0]} scale={[0.6, 1.2, 0.6]}>
                    <meshStandardMaterial {...getMatProps(colorStr)} />
                  </mesh>
                  {/* Guard platform rails on top */}
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 1.22, 0]} scale={[0.7, 0.04, 0.7]}>
                    <meshStandardMaterial color="#ffffff" />
                  </mesh>
                  {/* Roof over platform */}
                  <mesh {...commonProps} geometry={coneGeo} position={[0, 1.55, 0]} scale={[0.6, 0.5, 0.6]}>
                    <meshStandardMaterial color="#ef4444" flatShading />
                  </mesh>
                </group>

                {/* Giant spiral slide 1 (Orange Tube) descending into pool */}
                <group position={[-0.4, 0, -0.4]}>
                  {/* Upper segment */}
                  <mesh {...commonProps} geometry={cylinderGeo} position={[-0.2, 0.9, -0.2]} scale={[0.16, 0.6, 0.16]} rotation={[0.4, 0, -0.5]}>
                    <meshStandardMaterial color="#f97316" roughness={0.2} />
                  </mesh>
                  {/* Mid segment */}
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0.2, 0.5, 0.2]} scale={[0.16, 0.7, 0.16]} rotation={[0.5, 0, 0.4]}>
                    <meshStandardMaterial color="#f97316" roughness={0.2} />
                  </mesh>
                  {/* Splash nozzle */}
                  <mesh {...commonProps} geometry={sphereGeo} position={[0.42, 0.1, 0.42]} scale={[0.24, 0.2, 0.24]}>
                    <meshStandardMaterial color="#22d3ee" transparent opacity={0.6} />
                  </mesh>
                </group>

                {/* Fast straight slide 2 (Yellow Open Chute) */}
                <group position={[0.5, 0, -0.5]}>
                  <mesh {...commonProps} geometry={boxGeo} position={[-0.1, 0.6, -0.3]} scale={[0.25, 0.12, 1.2]} rotation={[0.5, 0, 0]}>
                    <meshStandardMaterial color="#fbbf24" {...getMatProps(colorStr)} />
                  </mesh>
                  {/* Concrete pillar supports */}
                  <mesh {...commonProps} geometry={cylinderGeo} position={[-0.1, 0.3, -0.5]} scale={[0.06, 0.6, 0.06]}>
                    <meshStandardMaterial color="#64748b" />
                  </mesh>
                </group>

                {/* Striped Beach Loungers with Parasols / Umbrellas */}
                <group position={[0.8, 0, 0.9]}>
                  {/* Lounger 1 */}
                  <mesh {...commonProps} geometry={boxGeo} position={[-0.2, 0.04, 0]} scale={[0.22, 0.05, 0.46]}>
                    <meshStandardMaterial color="#3b82f6" />
                  </mesh>
                  {/* Parasol */}
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0.15, 0.36, -0.1]} scale={[0.02, 0.72, 0.02]}>
                    <meshStandardMaterial color="#ffffff" />
                  </mesh>
                  <mesh {...commonProps} geometry={coneGeo} position={[0.15, 0.74, -0.1]} scale={[0.42, 0.18, 0.42]}>
                    <meshStandardMaterial color="#ef4444" flatShading />
                  </mesh>
                </group>

                <group position={[-0.8, 0, 0.9]}>
                  {/* Lounger 2 */}
                  <mesh {...commonProps} geometry={boxGeo} position={[0.2, 0.04, 0]} scale={[0.22, 0.05, 0.46]}>
                    <meshStandardMaterial color="#10b981" />
                  </mesh>
                  {/* Parasol */}
                  <mesh {...commonProps} geometry={cylinderGeo} position={[-0.15, 0.36, -0.1]} scale={[0.02, 0.72, 0.02]}>
                    <meshStandardMaterial color="#ffffff" />
                  </mesh>
                  <mesh {...commonProps} geometry={coneGeo} position={[-0.15, 0.74, -0.1]} scale={[0.42, 0.18, 0.42]}>
                    <meshStandardMaterial color="#3b82f6" flatShading />
                  </mesh>
                </group>

                {/* Tropical Accent Vegetation Palm Trees */}
                <group position={[1.1, 0, -1.0]}>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 0.45, 0]} scale={[0.06, 0.9, 0.06]} rotation={[0.15, 0, 0]}>
                    <meshStandardMaterial color="#78350f" />
                  </mesh>
                  <mesh {...commonProps} geometry={sphereGeo} position={[0.07, 0.9, -0.015]} scale={[0.36, 0.18, 0.36]}>
                    <meshStandardMaterial color="#22c55e" flatShading />
                  </mesh>
                </group>
              </>
            );

          case BuildingType.AmusementPark:
            // Giant Theme Carnival & Amusement Park (Парк Аттракционов) - 4x4 footprint
            return (
              <>
                {/* Cobblestone paving plaza flagstone ground */}
                <mesh position={[0, 0.005, 0]} scale={[3.9, 0.01, 3.9]} geometry={boxGeo}>
                  <meshStandardMaterial color="#78716c" roughness={0.7} />
                </mesh>

                {/* Decorative Entrance Archway structures */}
                <group position={[0, 0, 1.8]}>
                  {/* Pillar Left */}
                  <mesh {...commonProps} geometry={boxGeo} position={[-0.6, 0.45, 0]} scale={[0.16, 0.9, 0.16]}>
                    <meshStandardMaterial color="#db2777" />
                  </mesh>
                  {/* Pillar Right */}
                  <mesh {...commonProps} geometry={boxGeo} position={[0.6, 0.45, 0]} scale={[0.16, 0.9, 0.16]}>
                    <meshStandardMaterial color="#db2777" />
                  </mesh>
                  {/* Arch header bar */}
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 0.95, 0]} scale={[1.4, 0.15, 0.2]}>
                    <meshStandardMaterial color="#fbbf24" />
                  </mesh>
                  {/* Little colorful flags */}
                  <mesh {...commonProps} geometry={coneGeo} position={[-0.4, 1.1, 0]} scale={[0.08, 0.15, 0.08]}>
                    <meshStandardMaterial color="#ef4444" />
                  </mesh>
                  <mesh {...commonProps} geometry={coneGeo} position={[0, 1.1, 0]} scale={[0.08, 0.15, 0.08]}>
                    <meshStandardMaterial color="#3b82f6" />
                  </mesh>
                  <mesh {...commonProps} geometry={coneGeo} position={[0.4, 1.1, 0]} scale={[0.08, 0.15, 0.08]}>
                    <meshStandardMaterial color="#10b981" />
                  </mesh>
                </group>

                {/* Majestic animated Ferris Wheel (Чертово колесо) on left */}
                <group position={[-0.9, 0, -0.4]} rotation={[0, Math.PI/4, 0]}>
                  {/* Frame Stand (A-frame legs in hot pink) */}
                  <mesh {...commonProps} geometry={cylinderGeo} position={[-0.4, 0.8, 0]} scale={[0.05, 1.6, 0.05]} rotation={[0, 0, 0.24]}>
                    <meshStandardMaterial color="#ec4899" />
                  </mesh>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0.4, 0.8, 0]} scale={[0.05, 1.6, 0.05]} rotation={[0, 0, -0.24]}>
                    <meshStandardMaterial color="#ec4899" />
                  </mesh>
                  {/* Central axle node */}
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 1.5, 0]} scale={[0.15, 0.22, 0.15]} rotation={[Math.PI / 2, 0, 0]}>
                    <meshStandardMaterial color="#fcd34d" metalness={0.9} />
                  </mesh>
                  
                  {/* Ferris Wheel Rim structure */}
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 1.5, 0]} scale={[1.4, 0.05, 1.4]} rotation={[Math.PI / 2, 0, 0.3]}>
                    <meshStandardMaterial color="#ffffff" transparent opacity={0.6} wireframe />
                  </mesh>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 1.5, 0]} scale={[1.1, 0.05, 1.1]} rotation={[Math.PI / 2, 0, 0]}>
                    <meshStandardMaterial color="#60a5fa" transparent opacity={0.8} wireframe />
                  </mesh>

                  {/* Hanging Cabins (8 Passenger Gondolas) */}
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 2.2, 0.04]} scale={[0.16, 0.16, 0.16]}>
                    <meshStandardMaterial color="#ef4444" />
                  </mesh>
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 0.8, 0.04]} scale={[0.16, 0.16, 0.16]}>
                    <meshStandardMaterial color="#3b82f6" />
                  </mesh>
                  <mesh {...commonProps} geometry={boxGeo} position={[-0.7, 1.5, 0.04]} scale={[0.16, 0.16, 0.16]}>
                    <meshStandardMaterial color="#22c55e" />
                  </mesh>
                  <mesh {...commonProps} geometry={boxGeo} position={[0.7, 1.5, 0.04]} scale={[0.16, 0.16, 0.16]}>
                    <meshStandardMaterial color="#eab308" />
                  </mesh>
                </group>

                {/* Roller Coaster high scaffolds and steel rails on right */}
                <group position={[0.9, 0, -0.2]}>
                  {/* Coaster Rails (Intertwining curves using red thin elements) */}
                  <mesh {...commonProps} geometry={boxGeo} position={[-0.1, 0.9, -0.5]} scale={[0.08, 0.08, 1.8]} rotation={[0.3, 0.2, 0]}>
                    <meshStandardMaterial color="#ef4444" metalness={0.7} />
                  </mesh>
                  <mesh {...commonProps} geometry={boxGeo} position={[0.1, 1.1, -0.4]} scale={[0.08, 0.08, 1.8]} rotation={[0.3, 0.2, 0]}>
                    <meshStandardMaterial color="#facc15" metalness={0.7} />
                  </mesh>
                  
                  {/* Support columns of structures */}
                  <mesh {...commonProps} geometry={cylinderGeo} position={[-0.4, 0.6, -0.8]} scale={[0.04, 1.2, 0.04]}>
                    <meshStandardMaterial color="#475569" />
                  </mesh>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0.2, 0.8, -0.2]} scale={[0.04, 1.6, 0.04]}>
                    <meshStandardMaterial color="#475569" />
                  </mesh>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0.4, 0.4, 0.4]} scale={[0.04, 0.8, 0.04]}>
                    <meshStandardMaterial color="#475569" />
                  </mesh>

                  {/* Coaster Train Cars climbing */}
                  <group position={[0.1, 1.25, -0.25]} rotation={[0.3, 0.2, 0]}>
                    <mesh {...commonProps} geometry={boxGeo} position={[0, 0, 0]} scale={[0.16, 0.12, 0.3]}>
                      <meshStandardMaterial color="#1e1b4b" roughness={0.1} />
                    </mesh>
                    <mesh {...commonProps} geometry={boxGeo} position={[0, 0, 0.35]} scale={[0.16, 0.12, 0.3]}>
                      <meshStandardMaterial color="#312e81" roughness={0.1} />
                    </mesh>
                  </group>
                </group>

                {/* Classic Circus tent Carousel (Карусель) in the middle */}
                <group position={[0, 0, -0.8]}>
                  {/* Platform */}
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 0.1, 0]} scale={[1.1, 0.18, 1.1]}>
                    <meshStandardMaterial color="#cbd5e1" />
                  </mesh>
                  {/* Center main golden pole */}
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 0.5, 0]} scale={[0.08, 0.9, 0.08]}>
                    <meshStandardMaterial color="#fbbf24" metalness={0.8} />
                  </mesh>
                  {/* Carousel Conical Striped Roof */}
                  <mesh {...commonProps} geometry={coneGeo} position={[0, 1.1, 0]} scale={[1.15, 0.42, 1.15]}>
                    <meshStandardMaterial color="#ea580c" flatShading />
                  </mesh>
                  
                  {/* Decorative horses pegs */}
                  <mesh {...commonProps} geometry={cylinderGeo} position={[-0.32, 0.35, -0.32]} scale={[0.03, 0.5, 0.03]}>
                    <meshStandardMaterial color="#fbbf24" />
                  </mesh>
                  <mesh {...commonProps} geometry={boxGeo} position={[-0.32, 0.35, -0.32]} scale={[0.1, 0.1, 0.16]}>
                    <meshStandardMaterial color="#a855f7" />
                  </mesh>

                  <mesh {...commonProps} geometry={cylinderGeo} position={[0.32, 0.35, 0.32]} scale={[0.03, 0.5, 0.03]}>
                    <meshStandardMaterial color="#fbbf24" />
                  </mesh>
                  <mesh {...commonProps} geometry={boxGeo} position={[0.32, 0.35, 0.32]} scale={[0.1, 0.1, 0.16]}>
                    <meshStandardMaterial color="#06b6d4" />
                  </mesh>
                </group>

                {/* Sweet Popcorn Stand & Cotton Candy Cabin */}
                <group position={[-1.0, 0, 1.1]}>
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 0.3, 0]} scale={[0.62, 0.6, 0.52]}>
                    <meshStandardMaterial color="#3b82f6" />
                  </mesh>
                  {/* Canopy roof */}
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 0.65, 0]} scale={[0.7, 0.12, 0.6]} rotation={[0.08, 0, 0]}>
                    <meshStandardMaterial color="#ef4444" />
                  </mesh>
                  {/* Vendor counter slit */}
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 0.4, 0.27]} scale={[0.46, 0.18, 0.02]}>
                    <meshStandardMaterial color="#1e293b" />
                  </mesh>
                </group>

                {/* Stately central green shrubs & Trees layout */}
                <TreeGroup i={3} pos={[-1.5, -1.5]} scale={1.1} />
                <TreeGroup i={4} pos={[1.5, -1.5]} scale={1.2} />
              </>
            );

          case BuildingType.HouseSmall:
            // Cozy Cottage (Suburban cottage)
            return (
              <>
                <mesh position={[0, 0.005, 0]} scale={[0.95, 0.01, 0.95]} geometry={boxGeo}>
                  <meshStandardMaterial color="#10b981" />
                </mesh>
                <mesh {...commonProps} geometry={boxGeo} position={[0, 0.3, 0]} scale={[0.78, 0.58, 0.78]}>
                  <meshStandardMaterial {...getMatProps(colorStr)} />
                </mesh>
                <mesh {...commonProps} geometry={coneGeo} position={[0, 0.79, 0]} scale={[0.74, 0.4, 0.74]} rotation={[0, Math.PI / 4, 0]}>
                  <meshStandardMaterial {...getMatProps(roofColorStr)} />
                </mesh>
                <mesh {...commonProps} geometry={cylinderGeo} position={[0.22, 0.7, -0.22]} scale={[0.08, 0.4, 0.08]}>
                  <meshStandardMaterial color="#4b5563" />
                </mesh>
                <mesh {...commonProps} geometry={boxGeo} position={[0, 0.16, 0.395]} scale={[0.18, 0.32, 0.02]}>
                  <meshStandardMaterial {...getMatProps(accentColorStr)} />
                </mesh>
                <WindowBlock position={[0.22, 0.35, 0.395]} scale={[0.16, 0.22, 0.02]} />
                <WindowBlock position={[-0.22, 0.35, 0.395]} scale={[0.16, 0.22, 0.02]} />
                <WindowBlock position={[0.395, 0.35, 0]} scale={[0.02, 0.22, 0.28]} />
                <WindowBlock position={[-0.395, 0.35, 0]} scale={[0.02, 0.22, 0.28]} />
              </>
            );

          case BuildingType.HouseMedium:
            // Modern Boxy Duplex
            return (
              <>
                <mesh position={[0, 0.005, 0]} scale={[0.95, 0.01, 1.95]} geometry={boxGeo}>
                  <meshStandardMaterial color="#059669" />
                </mesh>
                <mesh {...commonProps} geometry={boxGeo} position={[0, 0.3, 0]} scale={[0.84, 0.58, 1.76]}>
                  <meshStandardMaterial {...getMatProps(colorStr)} />
                </mesh>
                <mesh {...commonProps} geometry={boxGeo} position={[0, 0.85, -0.2]} scale={[0.76, 0.52, 1.2]}>
                  <meshStandardMaterial {...getMatProps(accentColorStr)} />
                </mesh>
                <mesh {...commonProps} geometry={boxGeo} position={[0, 0.65, 0.65]} scale={[0.76, 0.18, 0.05]}>
                  <meshStandardMaterial color="#d1d5db" transparent opacity={0.6} />
                </mesh>
                <WindowBlock position={[0, 0.82, 0.405]} scale={[0.3, 0.35, 0.02]} />
                <mesh {...commonProps} geometry={boxGeo} position={[0.2, 1.15, -0.4]} scale={[0.25, 0.15, 0.25]}>
                  <meshStandardMaterial color="#6b7280" />
                </mesh>
                <WindowBlock position={[0.22, 0.3, 0.885]} scale={[0.22, 0.3, 0.02]} />
                <mesh {...commonProps} geometry={boxGeo} position={[-0.22, 0.24, 0.885]} scale={[0.22, 0.45, 0.02]}>
                  <meshStandardMaterial color="#451a03" />
                </mesh>
                <WindowBlock position={[0.425, 0.3, -0.2]} scale={[0.02, 0.25, 0.6]} />
                <WindowBlock position={[-0.425, 0.3, -0.2]} scale={[0.02, 0.25, 0.6]} />
                <WindowBlock position={[0.385, 0.82, -0.2]} scale={[0.02, 0.22, 0.5]} />
              </>
            );

          case BuildingType.HouseLarge:
            // Luxurious Multi-story Volumetric Residence
            return (
              <>
                {/* Lobby / Ground Floor */}
                <mesh {...commonProps} geometry={boxGeo} position={[0, 0.25, 0]} scale={[1.75, 0.5, 1.75]}>
                  <meshStandardMaterial {...getMatProps(accentColorStr)} />
                </mesh>
                {/* High Density Volumetric Apartment block */}
                <mesh {...commonProps} geometry={boxGeo} position={[0, 1.25, 0]} scale={[1.65, 1.5, 1.65]}>
                  <meshStandardMaterial {...getMatProps(colorStr)} />
                </mesh>
                {/* Rooftop Penthouse and Solar panel */}
                <mesh {...commonProps} geometry={boxGeo} position={[-0.3, 2.15, -0.3]} scale={[0.55, 0.3, 0.55]}>
                  <meshStandardMaterial {...getMatProps(accentColorStr)} />
                </mesh>
                <mesh {...commonProps} geometry={boxGeo} position={[0.4, 2.05, 0.4]} scale={[0.55, 0.05, 0.55]} rotation={[0.25, 0, 0.25]}>
                  <meshStandardMaterial color="#1e3a8a" roughness={0.1} metalness={0.9} />
                </mesh>
                {/* Vertical structural facade accents */}
                <mesh {...commonProps} geometry={boxGeo} position={[-0.78, 1.0, 0.82]} scale={[0.15, 2.0, 0.15]}>
                  <meshStandardMaterial color="#cbd5e1" />
                </mesh>
                <mesh {...commonProps} geometry={boxGeo} position={[0.78, 1.0, 0.82]} scale={[0.15, 2.0, 0.15]}>
                  <meshStandardMaterial color="#cbd5e1" />
                </mesh>

                {/* Extruded Concrete Balconies */}
                <mesh {...commonProps} geometry={boxGeo} position={[-0.4, 0.72, 0.95]} scale={[0.5, 0.04, 0.3]}>
                  <meshStandardMaterial color="#e5e7eb" />
                </mesh>
                <mesh {...commonProps} geometry={boxGeo} position={[-0.4, 0.82, 1.09]} scale={[0.5, 0.16, 0.02]}>
                  <meshStandardMaterial color="#93c5fd" transparent opacity={0.6} roughness={0.1} />
                </mesh>

                <mesh {...commonProps} geometry={boxGeo} position={[0.4, 0.72, 0.95]} scale={[0.5, 0.04, 0.3]}>
                  <meshStandardMaterial color="#e5e7eb" />
                </mesh>
                <mesh {...commonProps} geometry={boxGeo} position={[0.4, 0.82, 1.09]} scale={[0.5, 0.16, 0.02]}>
                  <meshStandardMaterial color="#93c5fd" transparent opacity={0.6} roughness={0.1} />
                </mesh>

                <mesh {...commonProps} geometry={boxGeo} position={[-0.4, 1.22, 0.95]} scale={[0.5, 0.04, 0.3]}>
                  <meshStandardMaterial color="#e5e7eb" />
                </mesh>
                <mesh {...commonProps} geometry={boxGeo} position={[-0.4, 1.32, 1.09]} scale={[0.5, 0.16, 0.02]}>
                  <meshStandardMaterial color="#93c5fd" transparent opacity={0.6} roughness={0.1} />
                </mesh>

                <mesh {...commonProps} geometry={boxGeo} position={[0.4, 1.22, 0.95]} scale={[0.5, 0.04, 0.3]}>
                  <meshStandardMaterial color="#e5e7eb" />
                </mesh>
                <mesh {...commonProps} geometry={boxGeo} position={[0.4, 1.32, 1.09]} scale={[0.5, 0.16, 0.02]}>
                  <meshStandardMaterial color="#93c5fd" transparent opacity={0.6} roughness={0.1} />
                </mesh>

                {/* Glass Entrance door */}
                <mesh {...commonProps} geometry={boxGeo} position={[0, 0.2, 0.88]} scale={[0.4, 0.38, 0.02]}>
                  <meshStandardMaterial color="#1f2937" roughness={0.1} />
                </mesh>

                {/* front windows column left */}
                <WindowBlock position={[-0.4, 0.85, 0.83]} scale={[0.25, 0.22, 0.02]} />
                <WindowBlock position={[-0.4, 1.35, 0.83]} scale={[0.25, 0.22, 0.02]} />
                <WindowBlock position={[-0.4, 1.82, 0.83]} scale={[0.25, 0.22, 0.02]} />

                {/* front windows column right */}
                <WindowBlock position={[0.4, 0.85, 0.83]} scale={[0.25, 0.22, 0.02]} />
                <WindowBlock position={[0.4, 1.35, 0.83]} scale={[0.25, 0.22, 0.02]} />
                <WindowBlock position={[0.4, 1.82, 0.83]} scale={[0.25, 0.22, 0.02]} />

                {/* left side windows */}
                <WindowBlock position={[-0.83, 0.85, -0.3]} scale={[0.02, 0.22, 0.35]} />
                <WindowBlock position={[-0.83, 1.35, -0.3]} scale={[0.02, 0.22, 0.35]} />
                <WindowBlock position={[-0.83, 1.82, -0.3]} scale={[0.02, 0.22, 0.35]} />
                <WindowBlock position={[-0.83, 0.85, 0.3]} scale={[0.02, 0.22, 0.35]} />
                <WindowBlock position={[-0.83, 1.35, 0.3]} scale={[0.02, 0.22, 0.35]} />
                <WindowBlock position={[-0.83, 1.82, 0.3]} scale={[0.02, 0.22, 0.35]} />

                {/* right side windows */}
                <WindowBlock position={[0.83, 0.85, -0.3]} scale={[0.02, 0.22, 0.35]} />
                <WindowBlock position={[0.83, 1.35, -0.3]} scale={[0.02, 0.22, 0.35]} />
                <WindowBlock position={[0.83, 1.82, -0.3]} scale={[0.02, 0.22, 0.35]} />
                <WindowBlock position={[0.83, 0.85, 0.3]} scale={[0.02, 0.22, 0.35]} />
                <WindowBlock position={[0.83, 1.35, 0.3]} scale={[0.02, 0.22, 0.35]} />
                <WindowBlock position={[0.83, 1.82, 0.3]} scale={[0.02, 0.22, 0.35]} />
              </>
            );

                    case BuildingType.ShopLarge:
            // Luxurious Modern Supermarket (Супермаркет) - 2x3 footprint
            return (
              <>
                {/* Level Asphalt/Concrete foundation plate */}
                <mesh position={[0, 0.005, 0]} scale={[1.9, 0.01, 2.9]} geometry={boxGeo}>
                  <meshStandardMaterial color="#334155" />
                </mesh>

                {/* Main Supermarket Hall */}
                <mesh {...commonProps} geometry={boxGeo} position={[0, 0.35, -0.15]} scale={[1.7, 0.7, 2.4]}>
                  <meshStandardMaterial {...getMatProps(colorStr)} />
                </mesh>
                
                {/* Secondary glass atrium level overlay on the front */}
                <mesh {...commonProps} geometry={boxGeo} position={[0, 0.4, 0.5]} scale={[1.6, 0.8, 0.9]}>
                  <meshStandardMaterial {...getMatProps(accentColorStr)} />
                </mesh>

                {/* Massive Glass Entrance Facade */}
                <WindowBlock position={[0, 0.4, 0.96]} scale={[1.1, 0.5, 0.02]} />
                <WindowBlock position={[0.79, 0.4, 0.5]} scale={[0.02, 0.5, 0.6]} />
                <WindowBlock position={[-0.79, 0.4, 0.5]} scale={[0.02, 0.5, 0.6]} />

                {/* Entrance glass automatic slide doors */}
                <mesh {...commonProps} geometry={boxGeo} position={[0, 0.22, 0.97]} scale={[0.4, 0.42, 0.02]}>
                  <meshStandardMaterial color="#0f172a" roughness={0.1} />
                </mesh>

                {/* Elegant metal canopy over the entry */}
                <mesh {...commonProps} geometry={boxGeo} position={[0, 0.62, 1.05]} scale={[0.7, 0.04, 0.3]}>
                  <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.1} />
                </mesh>
                <mesh {...commonProps} geometry={cylinderGeo} position={[-0.32, 0.32, 1.15]} scale={[0.03, 0.64, 0.03]}>
                  <meshStandardMaterial color="#cbd5e1" />
                </mesh>
                <mesh {...commonProps} geometry={cylinderGeo} position={[0.32, 0.32, 1.15]} scale={[0.03, 0.64, 0.03]}>
                  <meshStandardMaterial color="#cbd5e1" />
                </mesh>

                {/* Side/rear loading dock rolling door (Delivery Area) */}
                <mesh {...commonProps} geometry={boxGeo} position={[-0.86, 0.25, -0.8]} scale={[0.02, 0.45, 0.6]} rotation={[0, 0, 0]}>
                  <meshStandardMaterial color="#475569" roughness={0.6} metalness={0.8} />
                </mesh>
                {/* Loading dock black protection bumper */}
                <mesh {...commonProps} geometry={boxGeo} position={[-0.87, 0.02, -0.8]} scale={[0.03, 0.05, 0.72]}>
                  <meshStandardMaterial color="#0f172a" />
                </mesh>

                {/* Elegant Glowing "SUPERMARKET" Sign Board */}
                <mesh {...commonProps} geometry={boxGeo} position={[0, 0.81, 0.65]} scale={[0.9, 0.18, 0.04]}>
                  <meshStandardMaterial color="#1e293b" />
                </mesh>
                <mesh {...commonProps} geometry={boxGeo} position={[0, 0.81, 0.68]} scale={[0.8, 0.1, 0.02]}>
                  <meshStandardMaterial color="#fda4af" emissive="#e11d48" emissiveIntensity={0.6} />
                </mesh>

                {/* Shopping Carts Storage Shed on the property */}
                <group position={[0.66, 0, 1.1]}>
                  {/* Base slab */}
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 0.005, 0]} scale={[0.42, 0.01, 0.42]}>
                    <meshStandardMaterial color="#64748b" />
                  </mesh>
                  {/* Pillars */}
                  <mesh {...commonProps} geometry={cylinderGeo} position={[-0.18, 0.18, -0.18]} scale={[0.02, 0.36, 0.02]}>
                    <meshStandardMaterial color="#cbd5e1" />
                  </mesh>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0.18, 0.18, -0.18]} scale={[0.02, 0.36, 0.02]}>
                    <meshStandardMaterial color="#cbd5e1" />
                  </mesh>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[-0.18, 0.18, 0.18]} scale={[0.02, 0.36, 0.02]}>
                    <meshStandardMaterial color="#cbd5e1" />
                  </mesh>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0.18, 0.18, 0.18]} scale={[0.02, 0.36, 0.02]}>
                    <meshStandardMaterial color="#cbd5e1" />
                  </mesh>
                  {/* Roof */}
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 0.36, 0]} scale={[0.44, 0.02, 0.44]}>
                    <meshStandardMaterial color="#38bdf8" transparent opacity={0.6} />
                  </mesh>
                  {/* Simulated metal shopping carts in row */}
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 0.12, 0]} scale={[0.26, 0.2, 0.32]}>
                    <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.2} />
                  </mesh>
                </group>

                {/* Rooftop Solar Panel array */}
                <mesh {...commonProps} geometry={boxGeo} position={[-0.35, 0.72, -0.6]} scale={[0.6, 0.02, 0.8]} rotation={[0.15, 0, 0.15]}>
                  <meshStandardMaterial color="#1e3a8a" roughness={0.15} metalness={0.8} />
                </mesh>
                <mesh {...commonProps} geometry={boxGeo} position={[0.35, 0.72, -0.6]} scale={[0.6, 0.02, 0.8]} rotation={[0.15, 0, 0.15]}>
                  <meshStandardMaterial color="#1e3a8a" roughness={0.15} metalness={0.8} />
                </mesh>

                {/* Rooftop AC exhaust blocks */}
                <mesh {...commonProps} geometry={boxGeo} position={[0.4, 0.75, 0.2]} scale={[0.25, 0.15, 0.25]}>
                  <meshStandardMaterial color="#cbd5e1" />
                </mesh>
                <mesh {...commonProps} geometry={cylinderGeo} position={[0.4, 0.85, 0.2]} scale={[0.14, 0.12, 0.14]}>
                  <meshStandardMaterial color="#1e293b" />
                </mesh>
              </>
            );
            
          case BuildingType.ShopSmall:
            // Detailed Local Market (Рынок) - 2x2 footprint
            return (
              <>
                {/* Plaza base slab */}
                <mesh position={[0, 0.005, 0]} scale={[1.9, 0.01, 1.9]} geometry={boxGeo}>
                  <meshStandardMaterial color="#cbd5e1" />
                </mesh>
                
                {/* Main Market Hall building in back */}
                <mesh {...commonProps} geometry={boxGeo} position={[0, 0.35, -0.3]} scale={[1.6, 0.7, 1.0]}>
                  <meshStandardMaterial {...getMatProps(colorStr)} />
                </mesh>
                {/* Clerestory / Skylight roof projection for the market hall */}
                <mesh {...commonProps} geometry={boxGeo} position={[0, 0.75, -0.3]} scale={[1.0, 0.15, 0.6]}>
                  <meshStandardMaterial {...getMatProps(accentColorStr)} />
                </mesh>
                <mesh {...commonProps} geometry={cylinderGeo} position={[0, 0.85, -0.3]} scale={[0.4, 0.1, 0.4]} rotation={[0, 0, 0]}>
                  <meshStandardMaterial color="#38bdf8" transparent opacity={0.6} />
                </mesh>

                {/* Market Hall large facade windows */}
                <WindowBlock position={[-0.4, 0.4, 0.21]} scale={[0.4, 0.3, 0.02]} />
                <WindowBlock position={[0.4, 0.4, 0.21]} scale={[0.4, 0.3, 0.02]} />
                <WindowBlock position={[0.81, 0.4, -0.3]} scale={[0.02, 0.3, 0.6]} />
                <WindowBlock position={[-0.81, 0.4, -0.3]} scale={[0.02, 0.3, 0.6]} />

                {/* Main Glass Sliding Doors for Market Hall */}
                <mesh {...commonProps} geometry={boxGeo} position={[0, 0.25, 0.21]} scale={[0.3, 0.5, 0.02]}>
                  <meshStandardMaterial color="#1e293b" metalness={0.9} roughness={0.1} />
                </mesh>

                {/* Outdoor market stall 1 (Farmers Market stand - Red/White tent) */}
                <group position={[-0.45, 0, 0.4]}>
                  {/* Table counters */}
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 0.15, 0]} scale={[0.5, 0.3, 0.4]}>
                    <meshStandardMaterial color="#854d0e" />
                  </mesh>
                  {/* Thin support rods */}
                  <mesh {...commonProps} geometry={cylinderGeo} position={[-0.2, 0.3, -0.15]} scale={[0.02, 0.6, 0.02]}>
                    <meshStandardMaterial color="#94a3b8" />
                  </mesh>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0.2, 0.3, -0.15]} scale={[0.02, 0.6, 0.02]}>
                    <meshStandardMaterial color="#94a3b8" />
                  </mesh>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[-0.2, 0.3, 0.15]} scale={[0.02, 0.6, 0.02]}>
                    <meshStandardMaterial color="#94a3b8" />
                  </mesh>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0.2, 0.3, 0.15]} scale={[0.02, 0.6, 0.02]}>
                    <meshStandardMaterial color="#94a3b8" />
                  </mesh>
                  {/* Striped Canopy roof */}
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 0.6, 0]} scale={[0.55, 0.05, 0.45]} rotation={[0.05, 0, 0]}>
                    <meshStandardMaterial color="#ef4444" />
                  </mesh>
                  {/* Stripe 1 */}
                  <mesh {...commonProps} geometry={boxGeo} position={[-0.15, 0.605, 0]} scale={[0.1, 0.052, 0.46]}>
                    <meshStandardMaterial color="#ffffff" />
                  </mesh>
                  {/* Stripe 2 */}
                  <mesh {...commonProps} geometry={boxGeo} position={[0.15, 0.605, 0]} scale={[0.1, 0.052, 0.46]}>
                    <meshStandardMaterial color="#ffffff" />
                  </mesh>
                </group>

                {/* Outdoor market stall 2 (Flower/Bakery stand - Yellow/White tent) */}
                <group position={[0.45, 0, 0.4]}>
                  {/* Table counters */}
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 0.15, 0]} scale={[0.5, 0.3, 0.4]}>
                    <meshStandardMaterial color="#78350f" />
                  </mesh>
                  {/* Thin support rods */}
                  <mesh {...commonProps} geometry={cylinderGeo} position={[-0.2, 0.3, -0.15]} scale={[0.02, 0.6, 0.02]}>
                    <meshStandardMaterial color="#94a3b8" />
                  </mesh>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0.2, 0.3, -0.15]} scale={[0.02, 0.6, 0.02]}>
                    <meshStandardMaterial color="#94a3b8" />
                  </mesh>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[-0.2, 0.3, 0.15]} scale={[0.02, 0.6, 0.02]}>
                    <meshStandardMaterial color="#94a3b8" />
                  </mesh>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0.2, 0.3, 0.15]} scale={[0.02, 0.6, 0.02]}>
                    <meshStandardMaterial color="#94a3b8" />
                  </mesh>
                  {/* Striped Canopy roof */}
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 0.6, 0]} scale={[0.55, 0.05, 0.45]} rotation={[0.05, 0, 0]}>
                    <meshStandardMaterial color="#eab308" />
                  </mesh>
                  {/* Stripe 1 */}
                  <mesh {...commonProps} geometry={boxGeo} position={[-0.15, 0.605, 0]} scale={[0.1, 0.052, 0.46]}>
                    <meshStandardMaterial color="#ffffff" />
                  </mesh>
                  {/* Stripe 2 */}
                  <mesh {...commonProps} geometry={boxGeo} position={[0.15, 0.605, 0]} scale={[0.1, 0.052, 0.46]}>
                    <meshStandardMaterial color="#ffffff" />
                  </mesh>
                </group>

                {/* Small plaza detail tree in the middle */}
                <group position={[0, 0, 0.5]}>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 0.15, 0]} scale={[0.06, 0.3, 0.06]}>
                    <meshStandardMaterial color="#78350f" />
                  </mesh>
                  <mesh {...commonProps} geometry={sphereGeo} position={[0, 0.4, 0]} scale={[0.22, 0.22, 0.22]}>
                    <meshStandardMaterial color="#15803d" flatShading />
                  </mesh>
                  {/* Simple circular bench */}
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 0.08, 0]} scale={[0.2, 0.02, 0.2]}>
                    <meshStandardMaterial color="#e2e8f0" />
                  </mesh>
                </group>
              </>
            );

case BuildingType.FactoryLarge:
            // Heavy Industry Manufacturing Plant (Огромный Завод) - 2x3 footprint
            return (
              <>
                {/* Large asphalt ground base with yellow marking border */}
                <mesh position={[0, 0.005, 0]} scale={[1.9, 0.01, 2.9]} geometry={boxGeo}>
                  <meshStandardMaterial color="#334155" />
                </mesh>

                {/* Section A: Main processing hangar block */}
                <mesh {...commonProps} geometry={boxGeo} position={[-0.15, 0.45, -0.45]} scale={[1.1, 0.9, 1.6]}>
                  <meshStandardMaterial {...getMatProps(colorStr)} />
                </mesh>
                {/* Sawtooth Roof 1 */}
                <mesh {...commonProps} geometry={boxGeo} position={[-0.42, 0.95, -0.45]} scale={[0.52, 0.22, 1.5]} rotation={[0, 0, Math.PI / 5]}>
                  <meshStandardMaterial {...getMatProps(roofColorStr)} />
                </mesh>
                {/* Sawtooth Roof 2 */}
                <mesh {...commonProps} geometry={boxGeo} position={[0.12, 0.95, -0.45]} scale={[0.52, 0.22, 1.5]} rotation={[0, 0, Math.PI / 5]}>
                  <meshStandardMaterial {...getMatProps(roofColorStr)} />
                </mesh>

                {/* Section B: Secondary shipping and office wing */}
                <mesh {...commonProps} geometry={boxGeo} position={[0.3, 0.35, 0.65]} scale={[0.9, 0.7, 0.9]}>
                  <meshStandardMaterial {...getMatProps(accentColorStr)} />
                </mesh>
                {/* Office high Windows */}
                <WindowBlock position={[0.76, 0.45, 0.65]} scale={[0.02, 0.2, 0.6]} />

                {/* Section C: Massive Outdoor Chemical Gas Cylinder */}
                <mesh {...commonProps} geometry={cylinderGeo} position={[-0.55, 0.55, 0.75]} scale={[0.5, 1.1, 0.5]}>
                  <meshStandardMaterial color="#cbd5e1" metalness={0.7} roughness={0.3} />
                </mesh>
                {/* Domed top for cylinder */}
                <mesh {...commonProps} geometry={sphereGeo} position={[-0.55, 1.1, 0.75]} scale={[0.5, 0.2, 0.5]}>
                  <meshStandardMaterial color="#475569" />
                </mesh>
                {/* Connecting pipeline to hangar */}
                <mesh {...commonProps} geometry={cylinderGeo} position={[-0.32, 0.6, 0.1]} scale={[0.06, 0.6, 0.06]} rotation={[Math.PI / 2, 0, 0]}>
                  <meshStandardMaterial color="#94a3b8" />
                </mesh>

                {/* Giant Rolling Shutter cargo bay door */}
                <mesh {...commonProps} geometry={boxGeo} position={[0.3, 0.25, 1.11]} scale={[0.55, 0.45, 0.02]}>
                  <meshStandardMaterial color="#0f172a" roughness={0.8} />
                </mesh>
                <mesh {...commonProps} geometry={boxGeo} position={[0.3, 0.5, 1.13]} scale={[0.7, 0.04, 0.1]}>
                  <meshStandardMaterial color="#1e293b" />
                </mesh>
                
                {/* Ground hazard yellow/black security markings in front of cargo bay */}
                <group position={[0.3, 0.012, 1.25]}>
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 0, 0]} scale={[0.55, 0.005, 0.22]}>
                    <meshStandardMaterial color="#eab308" />
                  </mesh>
                  {/* Black diagonal stripes */}
                  <mesh {...commonProps} geometry={boxGeo} position={[-0.15, 0.001, 0]} scale={[0.05, 0.006, 0.26]} rotation={[0, Math.PI / 4, 0]}>
                    <meshStandardMaterial color="#1e293b" />
                  </mesh>
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 0.001, 0]} scale={[0.05, 0.006, 0.26]} rotation={[0, Math.PI / 4, 0]}>
                    <meshStandardMaterial color="#1e293b" />
                  </mesh>
                  <mesh {...commonProps} geometry={boxGeo} position={[0.15, 0.001, 0]} scale={[0.05, 0.006, 0.26]} rotation={[0, Math.PI / 4, 0]}>
                    <meshStandardMaterial color="#1e293b" />
                  </mesh>
                </group>

                {/* Twin Smokestacks blowing heavily */}
                <SmokeStack position={[-0.55, 0.45, -0.85]} />
                <SmokeStack position={[-0.15, 0.45, -0.85]} />
              </>
            );

          case BuildingType.FactorySmall:
            // Medium Factory / Workshop (Фабрика) - 2x2 footprint
            return (
              <>
                {/* Concrete foundation slab */}
                <mesh position={[0, 0.005, 0]} scale={[1.9, 0.01, 1.9]} geometry={boxGeo}>
                  <meshStandardMaterial color="#475569" />
                </mesh>

                {/* Main manufacturing wing block */}
                <mesh {...commonProps} geometry={boxGeo} position={[-0.2, 0.35, -0.1]} scale={[1.1, 0.7, 1.4]}>
                  <meshStandardMaterial {...getMatProps(colorStr)} />
                </mesh>

                {/* Sawtooth / Pitched Roof 1 */}
                <mesh {...commonProps} geometry={boxGeo} position={[-0.45, 0.75, -0.1]} scale={[0.5, 0.16, 1.3]} rotation={[0, 0, Math.PI / 6]}>
                  <meshStandardMaterial {...getMatProps(roofColorStr)} />
                </mesh>
                {/* Sawtooth / Pitched Roof 2 */}
                <mesh {...commonProps} geometry={boxGeo} position={[0.05, 0.75, -0.1]} scale={[0.5, 0.16, 1.3]} rotation={[0, 0, Math.PI / 6]}>
                  <meshStandardMaterial {...getMatProps(roofColorStr)} />
                </mesh>

                {/* Storage tank cylinder */}
                <mesh {...commonProps} geometry={cylinderGeo} position={[0.55, 0.45, -0.4]} scale={[0.42, 0.9, 0.42]}>
                  <meshStandardMaterial {...getMatProps(accentColorStr)} />
                </mesh>
                <mesh {...commonProps} geometry={sphereGeo} position={[0.55, 0.9, -0.4]} scale={[0.42, 0.15, 0.42]}>
                  <meshStandardMaterial color="#64748b" />
                </mesh>

                {/* Smaller generator pipe */}
                <mesh {...commonProps} geometry={cylinderGeo} position={[0.55, 0.3, 0.3]} scale={[0.26, 0.6, 0.26]}>
                  <meshStandardMaterial color="#94a3b8" />
                </mesh>

                {/* Detailed window slits on factory side */}
                <WindowBlock position={[-0.76, 0.4, -0.1]} scale={[0.02, 0.25, 0.9]} />

                {/* Loading dock door */}
                <mesh {...commonProps} geometry={boxGeo} position={[0, 0.25, 0.61]} scale={[0.5, 0.45, 0.02]}>
                  <meshStandardMaterial color="#334155" roughness={0.7} metalness={0.6} />
                </mesh>
                <mesh {...commonProps} geometry={boxGeo} position={[0, 0.5, 0.63]} scale={[0.6, 0.04, 0.1]}>
                  <meshStandardMaterial color="#1e293b" />
                </mesh>

                {/* Industrial vents/exhaust on roof */}
                <mesh {...commonProps} geometry={boxGeo} position={[-0.4, 0.85, 0.3]} scale={[0.15, 0.15, 0.15]}>
                  <meshStandardMaterial color="#1e293b" />
                </mesh>
                <mesh {...commonProps} geometry={cylinderGeo} position={[-0.4, 0.95, 0.3]} scale={[0.08, 0.1, 0.08]}>
                  <meshStandardMaterial color="#94a3b8" />
                </mesh>

                {/* Animated Smokestack */}
                <SmokeStack position={[-0.55, 0.35, -0.65]} />
              </>
            );

          case BuildingType.ParkSmall:
            return (
              <>
                {/* Thin gray base border */}
                <mesh position={[0, 0.005, 0]} scale={[0.95, 0.01, 0.95]} geometry={boxGeo}>
                  <meshStandardMaterial color="#94a3b8" />
                </mesh>
                {/* Grass lawn */}
                <mesh position={[0, 0.01, 0]} scale={[0.88, 0.015, 0.88]} geometry={boxGeo}>
                  <meshStandardMaterial color="#4ade80" roughness={0.9} />
                </mesh>

                {/* Wooden bench */}
                <group position={[-0.2, 0.015, -0.2]} rotation={[0, Math.PI / 4, 0]}>
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 0.05, 0]} scale={[0.3, 0.02, 0.12]}>
                    <meshStandardMaterial color="#b45309" />
                  </mesh>
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 0.14, -0.05]} scale={[0.3, 0.14, 0.02]}>
                    <meshStandardMaterial color="#b45309" />
                  </mesh>
                  {/* Bench Legs */}
                  <mesh {...commonProps} geometry={boxGeo} position={[-0.12, 0.03, -0.03]} scale={[0.04, 0.06, 0.04]}>
                    <meshStandardMaterial color="#475569" />
                  </mesh>
                  <mesh {...commonProps} geometry={boxGeo} position={[0.12, 0.03, -0.03]} scale={[0.04, 0.06, 0.04]}>
                    <meshStandardMaterial color="#475569" />
                  </mesh>
                </group>

                {/* Classic street lamppost */}
                <group position={[0.25, 0.015, 0.25]}>
                  {/* Steel pole */}
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 0.32, 0]} scale={[0.03, 0.64, 0.03]}>
                    <meshStandardMaterial color="#1e293b" metalness={0.8} />
                  </mesh>
                  {/* Glowing warm bulb */}
                  <mesh {...commonProps} geometry={sphereGeo} position={[0, 0.64, 0]} scale={[0.12, 0.12, 0.12]}>
                    <meshStandardMaterial color="#fef08a" emissive="#eab308" emissiveIntensity={1.2} />
                  </mesh>
                </group>

                {/* Miniature Rose / tulip garden plot */}
                <group position={[0.22, 0.015, -0.22]}>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 0.03, 0]} scale={[0.2, 0.06, 0.2]}>
                    <meshStandardMaterial color="#334155" />
                  </mesh>
                  {/* Flowers (colored spheres) */}
                  <mesh {...commonProps} geometry={sphereGeo} position={[0.04, 0.06, 0.04]} scale={[0.05, 0.05, 0.05]}>
                    <meshStandardMaterial color="#ef4444" />
                  </mesh>
                  <mesh {...commonProps} geometry={sphereGeo} position={[-0.04, 0.06, -0.04]} scale={[0.05, 0.05, 0.05]}>
                    <meshStandardMaterial color="#ec4899" />
                  </mesh>
                  <mesh {...commonProps} geometry={sphereGeo} position={[0.04, 0.07, -0.04]} scale={[0.04, 0.04, 0.04]}>
                    <meshStandardMaterial color="#a855f7" />
                  </mesh>
                </group>

                {/* Small volumetric tree */}
                <TreeGroup i={5} pos={[-0.2, 0.2]} scale={0.8} />
              </>
            );

          case BuildingType.ParkLarge:
            return (
              <>
                {/* Stone walk border slab */}
                <mesh position={[0, 0.005, 0]} scale={[1.9, 0.01, 1.9]} geometry={boxGeo}>
                  <meshStandardMaterial color="#cbd5e1" />
                </mesh>
                {/* Lush emerald green grass base */}
                <mesh position={[0, 0.01, 0]} scale={[1.82, 0.015, 1.82]} geometry={boxGeo}>
                  <meshStandardMaterial color="#22c55e" roughness={0.9} />
                </mesh>

                {/* Central multi-tier cobblestone water fountain */}
                <group position={[0, 0.015, 0]}>
                  {/* Basin ring base */}
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 0.08, 0]} scale={[0.54, 0.16, 0.54]}>
                    <meshStandardMaterial color="#64748b" roughness={0.5} />
                  </mesh>
                  {/* Water surface inside basin */}
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 0.13, 0]} scale={[0.48, 0.06, 0.48]}>
                    <meshStandardMaterial color="#0ea5e9" roughness={0.1} metalness={0.9} transparent opacity={0.8} />
                  </mesh>
                  {/* Fountain stem column */}
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 0.26, 0]} scale={[0.1, 0.32, 0.1]}>
                    <meshStandardMaterial color="#94a3b8" />
                  </mesh>
                  {/* Spray sphere upper */}
                  <mesh {...commonProps} geometry={sphereGeo} position={[0, 0.44, 0]} scale={[0.14, 0.14, 0.14]}>
                    <meshStandardMaterial color="#38bdf8" transparent opacity={0.7} />
                  </mesh>
                </group>

                {/* Paved Walkways system (Paths cutting across) */}
                <mesh position={[0, 0.012, 0]} scale={[1.82, 0.005, 0.24]} geometry={boxGeo}>
                  <meshStandardMaterial color="#e2e8f0" />
                </mesh>
                <mesh position={[0, 0.012, 0]} scale={[0.24, 0.005, 1.82]} geometry={boxGeo}>
                  <meshStandardMaterial color="#e2e8f0" />
                </mesh>

                {/* Wooden Benches for rest */}
                <group position={[0.5, 0.015, -0.4]} rotation={[0, -Math.PI / 2, 0]}>
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 0.06, 0]} scale={[0.36, 0.02, 0.14]}>
                    <meshStandardMaterial color="#b45309" />
                  </mesh>
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 0.15, -0.06]} scale={[0.36, 0.12, 0.02]}>
                    <meshStandardMaterial color="#b45309" />
                  </mesh>
                </group>
                <group position={[-0.5, 0.015, 0.4]} rotation={[0, Math.PI / 2, 0]}>
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 0.06, 0]} scale={[0.36, 0.02, 0.14]}>
                    <meshStandardMaterial color="#b45309" />
                  </mesh>
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 0.15, -0.06]} scale={[0.36, 0.12, 0.02]}>
                    <meshStandardMaterial color="#b45309" />
                  </mesh>
                </group>

                {/* Corner Vintage Lampposts */}
                <group position={[-0.7, 0.015, -0.7]}>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 0.36, 0]} scale={[0.03, 0.72, 0.03]}>
                    <meshStandardMaterial color="#334155" />
                  </mesh>
                  <mesh {...commonProps} geometry={sphereGeo} position={[0, 0.72, 0]} scale={[0.12, 0.12, 0.12]}>
                    <meshStandardMaterial color="#fef08a" emissive="#eab308" emissiveIntensity={1.2} />
                  </mesh>
                </group>
                <group position={[0.7, 0.015, 0.7]}>
                  <mesh {...commonProps} geometry={cylinderGeo} position={[0, 0.36, 0]} scale={[0.03, 0.72, 0.03]}>
                    <meshStandardMaterial color="#334155" />
                  </mesh>
                  <mesh {...commonProps} geometry={sphereGeo} position={[0, 0.72, 0]} scale={[0.12, 0.12, 0.12]}>
                    <meshStandardMaterial color="#fef08a" emissive="#eab308" emissiveIntensity={1.2} />
                  </mesh>
                </group>

                {/* Flourishing Flower beds */}
                <group position={[-0.6, 0.015, 0.6]}>
                  <mesh {...commonProps} geometry={boxGeo} position={[0, 0.02, 0]} scale={[0.36, 0.04, 0.36]}>
                    <meshStandardMaterial color="#1e293b" />
                  </mesh>
                  <mesh {...commonProps} geometry={sphereGeo} position={[0.08, 0.05, 0.08]} scale={[0.06, 0.06, 0.06]}>
                    <meshStandardMaterial color="#ef4444" />
                  </mesh>
                  <mesh {...commonProps} geometry={sphereGeo} position={[-0.08, 0.05, -0.08]} scale={[0.06, 0.06, 0.06]}>
                    <meshStandardMaterial color="#fb923c" />
                  </mesh>
                  <mesh {...commonProps} geometry={sphereGeo} position={[-0.08, 0.05, 0.08]} scale={[0.06, 0.06, 0.06]}>
                    <meshStandardMaterial color="#ec4899" />
                  </mesh>
                  <mesh {...commonProps} geometry={sphereGeo} position={[0.08, 0.05, -0.08]} scale={[0.06, 0.06, 0.06]}>
                    <meshStandardMaterial color="#facc15" />
                  </mesh>
                </group>

                {/* Stately majestic green trees in corners */}
                <TreeGroup i={6} pos={[-0.6, -0.6]} scale={1.1} />
                <TreeGroup i={7} pos={[0.6, -0.6]} scale={0.9} />
                <TreeGroup i={8} pos={[0.6, 0.6]} scale={1.2} />
              </>
            );

          case BuildingType.Road:
          case BuildingType.BuyLand:
          default:
            return null;
        }
      })()}
    </group>
  );
});

// --- 2. Dynamic Systems (Traffic, Citizens, Environment) ---

const carColors = ['#ef4444', '#3b82f6', '#eab308', '#ffffff', '#1f2937', '#f97316'];

const TrafficSystem = ({ grid }: { grid: Grid }) => {
  const roadTiles = useMemo(() => {
    const roads: {x: number, y: number}[] = [];
    grid.forEach(row => row.forEach(tile => {
      if (tile.buildingType === BuildingType.Road) roads.push({x: tile.x, y: tile.y});
    }));
    return roads;
  }, [grid]);

  const carCount = Math.min(Math.floor(roadTiles.length * 0.15), 6);
  const carsRef = useRef<THREE.InstancedMesh>(null);
  const carsState = useRef<Float32Array>(new Float32Array(0)); 
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colors = useMemo(() => new Float32Array(0), []);

  useEffect(() => {
    if (roadTiles.length < 2) return;
    carsState.current = new Float32Array(carCount * 6);
    const newColors = new Float32Array(carCount * 3);

    for (let i = 0; i < carCount; i++) {
      const startNode = roadTiles[Math.floor(Math.random() * roadTiles.length)];
      carsState.current[i*6 + 0] = startNode.x;
      carsState.current[i*6 + 1] = startNode.y;
      carsState.current[i*6 + 2] = startNode.x;
      carsState.current[i*6 + 3] = startNode.y;
      carsState.current[i*6 + 4] = 1; // force pick new target
      carsState.current[i*6 + 5] = getRandomRange(0.01, 0.03); // speed

      const color = new THREE.Color(carColors[Math.floor(Math.random() * carColors.length)]);
      newColors[i*3] = color.r; newColors[i*3+1] = color.g; newColors[i*3+2] = color.b;
    }

    if (carsRef.current) {
        carsRef.current.instanceColor = new THREE.InstancedBufferAttribute(newColors, 3);
    }
  }, [roadTiles, carCount]);

  useFrame(() => {
    if (!carsRef.current || roadTiles.length < 2 || carsState.current.length === 0) return;

    for (let i = 0; i < carCount; i++) {
      const idx = i * 6;
      let curX = carsState.current[idx];
      let curY = carsState.current[idx+1];
      let tarX = carsState.current[idx+2];
      let tarY = carsState.current[idx+3];
      let progress = carsState.current[idx+4];
      const speed = carsState.current[idx+5];

      progress += speed;

      if (progress >= 1) {
        curX = tarX;
        curY = tarY;
        progress = 0;
        
        const neighbors = roadTiles.filter(t => 
          (Math.abs(t.x - curX) === 1 && t.y === curY) || 
          (Math.abs(t.y - curY) === 1 && t.x === curX)
        );

        if (neighbors.length > 0) {
            // Simple pathfinding: avoid going back immediately
            const valid = neighbors.length > 1 
                ? neighbors.filter(n => Math.abs(n.x - carsState.current[idx]) > 0.1 || Math.abs(n.y - carsState.current[idx+1]) > 0.1)
                : neighbors;
            
            const next = valid.length > 0 
                ? valid[Math.floor(Math.random() * valid.length)]
                : neighbors[0];
            
            tarX = next.x;
            tarY = next.y;
        } else {
            const rnd = roadTiles[Math.floor(Math.random() * roadTiles.length)];
            curX = rnd.x; curY = rnd.y; tarX = rnd.x; tarY = rnd.y;
        }
      }

      carsState.current[idx] = curX;
      carsState.current[idx+1] = curY;
      carsState.current[idx+2] = tarX;
      carsState.current[idx+3] = tarY;
      carsState.current[idx+4] = progress;

      // Interpolate position
      const gx = MathUtils.lerp(curX, tarX, progress);
      const gy = MathUtils.lerp(curY, tarY, progress);

      // Determine driving side offset
      const dx = tarX - curX;
      const dy = tarY - curY;
      const angle = Math.atan2(dy, dx);
      
      // Offset to right side relative to movement
      const offsetAmt = 0.15;
      // Normals: (-dy, dx)
      const len = Math.sqrt(dx*dx + dy*dy) || 1;
      const offX = (-dy/len) * offsetAmt;
      const offY = (dx/len) * offsetAmt;

      const [wx, _, wz] = gridToWorld(gx + offX, gy + offY);

      // Road surface is approx -0.3. Car height 0.15.
      dummy.position.set(wx, -0.3 + 0.075, wz);
      dummy.rotation.set(0, -angle, 0);
      // Car dimensions (Length(X), Height(Y), Width(Z) assuming 0 rotation aligns with X)
      dummy.scale.set(0.5, 0.15, 0.3); 
      
      dummy.updateMatrix();
      carsRef.current.setMatrixAt(i, dummy.matrix);
    }
    carsRef.current.instanceMatrix.needsUpdate = true;
  });

  if (roadTiles.length < 2) return null;

  return (
    <instancedMesh ref={carsRef} args={[boxGeo, undefined, carCount]} castShadow={false}>
      <meshStandardMaterial roughness={0.5} metalness={0.3} />
    </instancedMesh>
  );
};

const clothesColors = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#ffffff'];

const PopulationSystem = ({ population, grid }: { population: number, grid: Grid }) => {
    const agentCount = Math.min(Math.floor(population / 25), 25); 
    const meshRef = useRef<THREE.InstancedMesh>(null);
    
    // Find tiles where people can walk (Roads, Parks, empty ground)
    const walkableTiles = useMemo(() => {
        const tiles: {x: number, y: number}[] = [];
        grid.forEach(row => row.forEach(tile => {
          if (tile.unlocked && (tile.buildingType === BuildingType.Road || tile.buildingType === BuildingType.ParkSmall || tile.buildingType === BuildingType.ParkLarge || tile.buildingType === BuildingType.None)) {
            tiles.push({x: tile.x, y: tile.y});
          }
        }));
        return tiles;
    }, [grid]);
    
    const agentsState = useRef<Float32Array>(new Float32Array(0));
    const dummy = useMemo(() => new THREE.Object3D(), []);
    
    useEffect(() => {
        if (agentCount === 0 || walkableTiles.length === 0) return;
        agentsState.current = new Float32Array(agentCount * 6);
        const newColors = new Float32Array(agentCount * 3);

        for(let i=0; i<agentCount; i++) {
            const t = walkableTiles[Math.floor(Math.random() * walkableTiles.length)];
            // Spawn with random offset in tile
            const x = t.x + getRandomRange(-0.4, 0.4);
            const y = t.y + getRandomRange(-0.4, 0.4);

            agentsState.current[i*6+0] = x;
            agentsState.current[i*6+1] = y;
            
            // Initial target
            const tt = walkableTiles[Math.floor(Math.random() * walkableTiles.length)];
            agentsState.current[i*6+2] = tt.x + getRandomRange(-0.4, 0.4);
            agentsState.current[i*6+3] = tt.y + getRandomRange(-0.4, 0.4);
            
            agentsState.current[i*6+4] = getRandomRange(0.005, 0.015); // speed
            agentsState.current[i*6+5] = Math.random() * Math.PI * 2; // anim

            const c = new THREE.Color(clothesColors[Math.floor(Math.random() * clothesColors.length)]);
            newColors[i*3] = c.r; newColors[i*3+1] = c.g; newColors[i*3+2] = c.b;
        }

        if (meshRef.current) {
            meshRef.current.instanceColor = new THREE.InstancedBufferAttribute(newColors, 3);
        }
    }, [agentCount, walkableTiles]);

    useFrame((state) => {
        if (!meshRef.current || agentCount === 0 || agentsState.current.length === 0) return;
        const time = state.clock.elapsedTime;

        for(let i=0; i<agentCount; i++) {
            const idx = i*6;
            let x = agentsState.current[idx];
            let y = agentsState.current[idx+1];
            let tx = agentsState.current[idx+2];
            let ty = agentsState.current[idx+3];
            const speed = agentsState.current[idx+4];
            const animOffset = agentsState.current[idx+5];

            const dx = tx - x;
            const dy = ty - y;
            const dist = Math.sqrt(dx*dx + dy*dy);

            if (dist < 0.1) {
                // Pick new random target from walkable
                if (walkableTiles.length > 0) {
                    const tt = walkableTiles[Math.floor(Math.random() * walkableTiles.length)];
                    tx = tt.x + getRandomRange(-0.4, 0.4);
                    ty = tt.y + getRandomRange(-0.4, 0.4);
                    agentsState.current[idx+2] = tx;
                    agentsState.current[idx+3] = ty;
                }
            } else {
                x += (dx/dist) * speed;
                y += (dy/dist) * speed;
                agentsState.current[idx] = x;
                agentsState.current[idx+1] = y;
            }

            const [wx, _, wz] = gridToWorld(x, y);

            // Walking bounce
            const bounce = Math.abs(Math.sin(time * 10 + animOffset)) * 0.03;

            // Person dimensions
            const height = 0.2;
            const width = 0.08;
            // Ground level approx -0.3 to -0.4
            const groundY = -0.35; 

            dummy.position.set(wx, groundY + height/2 + bounce, wz);
            dummy.rotation.set(0, -Math.atan2(dy, dx), 0);
            dummy.scale.set(width, height, width);
            
            dummy.updateMatrix();
            meshRef.current.setMatrixAt(i, dummy.matrix);
        }
        meshRef.current.instanceMatrix.needsUpdate = true;
    });

    if (agentCount === 0) return null;

    return (
        <instancedMesh ref={meshRef} args={[boxGeo, undefined, agentCount]} castShadow={false}>
            <meshStandardMaterial roughness={0.8} />
        </instancedMesh>
    )
};

// Clouds & Birds
const Cloud = ({ position, scale, speed }: { position: [number, number, number], scale: number, speed: number }) => {
    const group = useRef<THREE.Group>(null);
    useFrame((state, delta) => {
        if (group.current) {
            group.current.position.x += speed * delta;
            if (group.current.position.x > GRID_SIZE * 1.5) group.current.position.x = -GRID_SIZE * 1.5;
        }
    });

    const bubbles = useMemo(() => Array.from({length: 5 + Math.random() * 5}).map(() => ({
        pos: [getRandomRange(-1,1), getRandomRange(-0.5, 0.5), getRandomRange(-1,1)] as [number, number, number],
        scale: getRandomRange(0.5, 1.2)
    })), []);

    return (
        <group ref={group} position={position} scale={scale}>
            {bubbles.map((b, i) => (
                <mesh key={i} geometry={sphereGeo} position={b.pos} scale={b.scale} castShadow={false}>
                    <meshStandardMaterial color="white" flatShading opacity={0.9} transparent />
                </mesh>
            ))}
        </group>
    )
}

const Bird = ({ position, speed, offset }: { position: [number, number, number], speed: number, offset: number }) => {
    const ref = useRef<THREE.Group>(null);
    useFrame((state) => {
        if(ref.current) {
            const time = state.clock.elapsedTime + offset;
            ref.current.position.x = position[0] + Math.sin(time * speed) * GRID_SIZE;
            ref.current.position.z = position[1] + Math.cos(time * speed) * GRID_SIZE/2;
            ref.current.rotation.y = -time * speed + Math.PI;
            ref.current.scale.y = 1 + Math.sin(time * 15) * 0.3;
        }
    });

    return (
        <group ref={ref} position={[position[0], position[2], position[1]]}>
            <mesh geometry={boxGeo} scale={[0.2, 0.05, 0.05]} position={[0.1,0,0]} rotation={[0, Math.PI/4, 0]}><meshBasicMaterial color="#333" /></mesh>
            <mesh geometry={boxGeo} scale={[0.2, 0.05, 0.05]} position={[-0.1,0,0]} rotation={[0, -Math.PI/4, 0]}><meshBasicMaterial color="#333" /></mesh>
        </group>
    )
}

const EnvironmentEffects = () => {
    return (
        <group raycast={() => null}>
             {/* Clouds */}
            <Cloud position={[-12, 8, 4]} scale={1.5} speed={0.3} />
            <Cloud position={[5, 9, -8]} scale={1.2} speed={0.5} />
            <Cloud position={[15, 7, 10]} scale={1.8} speed={0.2} />
            
            {/* Birds */}
            <group position={[0, 0, 0]} scale={0.8}>
                <Bird position={[0, 0, 10]} speed={0.6} offset={0} />
                <Bird position={[0, 0, 10]} speed={0.6} offset={1.2} />
                <Bird position={[0, 0, 10]} speed={0.6} offset={2.5} />
            </group>

            {/* Huge Grass Base plane to cover to horizon */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.85, 0]} receiveShadow={false}>
                <planeGeometry args={[GRID_SIZE * 50, GRID_SIZE * 50]} />
                <meshStandardMaterial color="#10b981" roughness={1} metalness={0} />
            </mesh>
        </group>
    )
};

const EnvironmentSystem = () => {
    const { scene } = useThree();
    const lightRef = useRef<THREE.DirectionalLight>(null);
    const ambientRef = useRef<THREE.AmbientLight>(null);
    const targetSkyColor = useMemo(() => new THREE.Color(), []);
    const targetLightColor = useMemo(() => new THREE.Color(), []);
    
    useFrame(({ clock }) => {
        const cycleDuration = 15; // 15 seconds
        
        // Sine wave for smooth continuous transition
        // value ranges from -1 to 1
        const cyclePhase = Math.sin((clock.elapsedTime / cycleDuration) * Math.PI * 2);
        
        // Map sine wave to 0-1 range for lerp
        // Shift it so that it spends more time in day/night and less in transition
        // We can do this by clamping or using a smoothstep, but keeping it simple:
        const t = (Math.sin((clock.elapsedTime / cycleDuration) * Math.PI * 2 - Math.PI/2) + 1) / 2;
        
        // t goes smoothly from 0 (night) to 1 (day)
        targetSkyColor.lerpColors(new THREE.Color('#0f172a'), new THREE.Color('#87CEEB'), t);
        targetLightColor.lerpColors(new THREE.Color('#3b82f6'), new THREE.Color('#fffbeb'), t);
        
        if (lightRef.current) lightRef.current.intensity = THREE.MathUtils.lerp(0.3, 1.2, t);
        if (ambientRef.current) ambientRef.current.intensity = THREE.MathUtils.lerp(0.2, 0.6, t);

        scene.background = targetSkyColor;
        if (lightRef.current) lightRef.current.color.copy(targetLightColor);
    });

    return (
        <>
           <ambientLight ref={ambientRef} color="#ffffff" />
           <directionalLight
             ref={lightRef}
             castShadow
             position={[15, 20, 10]}
             shadow-mapSize={[2048, 2048]}
             shadow-camera-left={-25} shadow-camera-right={25}
             shadow-camera-top={25} shadow-camera-bottom={-25}
           />
        </>
    );
};

const CameraController = () => {
    const isDev = new URLSearchParams(window.location.search).get('dev') === 'true';
    const { camera, controls } = useThree();

    useFrame(() => {
        if (!controls || isDev) return;
        const ctrl = controls as any;
        
        // Clamp target (panning constraints)
        // Dynamically adjust panLimit based on zoom level: map edge is more noticeable when zoomed out
        let panLimit = GRID_SIZE * 0.4;
        
        if (camera instanceof THREE.OrthographicCamera) {
            const z = camera.zoom;
            panLimit = THREE.MathUtils.mapLinear(z, 5, 100, GRID_SIZE * 0.1, GRID_SIZE * 0.45);
            
            // Re-clamp target based on dynamic panLimit
            ctrl.target.x = THREE.MathUtils.clamp(ctrl.target.x, -panLimit, panLimit);
            ctrl.target.z = THREE.MathUtils.clamp(ctrl.target.z, -panLimit, panLimit);

            // Prevent tilting too low when zoomed out
            if (z < 15) {
                ctrl.maxPolarAngle = Math.PI / 3.5; // Stricter angle when zoomed out (top-down bias)
            } else {
                const t = Math.min((z - 15) / 65, 1);
                ctrl.maxPolarAngle = THREE.MathUtils.lerp(Math.PI / 3.5, Math.PI / 2.5, t); // Even when zoomed in, don't allow too low
            }
        }
    });

    return null;
};

// --- 3. Main Map Component ---

const RoadMarkings = React.memo(({ x, y, grid, yOffset }: { x: number; y: number; grid: Grid; yOffset: number }) => {
  const lineMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: '#fbbf24' }), []);
  const lineGeo = useMemo(() => new THREE.PlaneGeometry(0.1, 0.5), []);

  const hasUp = y > 0 && grid[y - 1][x].buildingType === BuildingType.Road;
  const hasDown = y < GRID_SIZE - 1 && grid[y + 1][x].buildingType === BuildingType.Road;
  const hasLeft = x > 0 && grid[y][x - 1].buildingType === BuildingType.Road;
  const hasRight = x < GRID_SIZE - 1 && grid[y][x + 1].buildingType === BuildingType.Road;

  const connections = [hasUp, hasDown, hasLeft, hasRight].filter(Boolean).length;
  
  // Isolated road piece: draw a default line
  if (connections === 0) {
    return (
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, yOffset, 0]} geometry={lineGeo} material={lineMaterial} />
    );
  }

  return (
    <group rotation={[-Math.PI / 2, 0, 0]} position={[0, yOffset, 0]}>
      {/* Center point for junctions to fill the gap, lifted slightly to avoid z-fighting */}
      {(hasUp || hasDown) && (hasLeft || hasRight) && (
        <mesh position={[0, 0, 0.005]} material={lineMaterial}>
           <planeGeometry args={[0.12, 0.12]} />
        </mesh>
      )}

      {hasUp && <mesh position={[0, 0.25, 0]} geometry={lineGeo} material={lineMaterial} />}
      {hasDown && <mesh position={[0, -0.25, 0]} geometry={lineGeo} material={lineMaterial} />}
      {hasLeft && <mesh position={[-0.25, 0, 0]} rotation={[0, 0, Math.PI / 2]} geometry={lineGeo} material={lineMaterial} />}
      {hasRight && <mesh position={[0.25, 0, 0]} rotation={[0, 0, Math.PI / 2]} geometry={lineGeo} material={lineMaterial} />}
    </group>
  );
});

const GroundInstances = React.memo(({ grid, hoveredTool }: { grid: Grid, hoveredTool: BuildingType | null }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const color = useMemo(() => new THREE.Color(), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    if (!meshRef.current) return;
    const mesh = meshRef.current;
    
    // Check if selected building is industrial
    const isIndustrial = hoveredTool === BuildingType.FactorySmall || 
                        hoveredTool === BuildingType.FactoryLarge || 
                        hoveredTool === BuildingType.ChemicalPlant || 
                        hoveredTool === BuildingType.HighTechFactory;

    // Pre-collect coordinates of all houses
    const houses: {x: number, y: number}[] = [];
    if (isIndustrial) {
      for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
          const tile = grid[y][x];
          if (tile.unlocked && (
            tile.buildingType === BuildingType.HouseSmall ||
            tile.buildingType === BuildingType.HouseMedium ||
            tile.buildingType === BuildingType.HouseLarge
          )) {
            houses.push({ x, y });
          }
        }
      }
    }

    let i = 0;
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const tile = grid[y][x];
        const [wx, _, wz] = gridToWorld(x, y);
        let c = '#10b981';
        let topY = -0.3;
        let thickness = 0.5;

        if (!tile.unlocked) {
           c = '#64748b'; topY = -0.4;
        } else if (isIndustrial) {
           // Industrial placement heatmap overlay:
           // Calculate affected houses count within distance <= 4
           let affectedCount = 0;
           for (let hIndex = 0; hIndex < houses.length; hIndex++) {
             const house = houses[hIndex];
             const dist = Math.max(Math.abs(house.x - x), Math.abs(house.y - y));
             if (dist <= 4) {
               affectedCount++;
             }
           }

           if (affectedCount === 0) {
             c = '#22c55e'; // Safe green - won't affect any inhabitants
           } else if (affectedCount <= 2) {
             c = '#eab308'; // Warning yellow - low/moderate impact
           } else {
             c = '#ef4444'; // Danger red - high impact on resident happiness
           }
           topY = -0.28;
        } else if (tile.buildingType === BuildingType.None) {
           const noise = getHash(x, y);
           c = noise > 0.7 ? '#059669' : noise > 0.3 ? '#10b981' : '#34d399';
           topY = -0.3 - noise * 0.1;
        } else if (tile.buildingType === BuildingType.Road) {
           c = '#374151'; topY = -0.29;
        } else {
           c = '#d1d5db'; topY = -0.28;
        }

        const centerY = topY - thickness/2;
        
        dummy.position.set(wx, centerY, wz);
        dummy.scale.set(1, thickness, 1);
        dummy.updateMatrix();
        
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, color.set(c));
        i++;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [grid, hoveredTool]);

  return (
    <instancedMesh ref={meshRef} args={[boxGeo, undefined, GRID_SIZE * GRID_SIZE]} receiveShadow={false} castShadow={false}>
      <meshStandardMaterial flatShading roughness={1} />
    </instancedMesh>
  );
});

// Selection/Hover Cursor
const Cursor = ({ x, y, width, height, color }: { x: number, y: number, width: number, height: number, color: string }) => {
  const [wx, _, wz] = gridToWorld(x + (width - 1) / 2, y + (height - 1) / 2);
  return (
    <mesh position={[wx, -0.25, wz]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial color={color} transparent opacity={0.4} side={THREE.DoubleSide} depthTest={false} />
      <Outlines thickness={0.05} color="white" />
    </mesh>
  );
};


const PreviewBuilding = ({ type, color, x, y, position }: { type: BuildingType; color: string; x: number; y: number; position: [number, number, number] }) => {
  const { camera } = useThree();
  const [rotation, setRotation] = useState(0);

  useFrame(() => {
    const actRot = getSnappedCameraAngle(camera);
    if (actRot !== rotation) {
      setRotation(actRot);
    }
  });

  return (
    <group position={position}>
      <Float speed={3} rotationIntensity={0} floatIntensity={0.1} floatingRange={[0, 0.1]}>
        <ProceduralBuilding 
          type={type} 
          baseColor={color} 
          x={x} 
          y={y} 
          transparent 
          opacity={0.7} 
          rotation={rotation}
        />
      </Float>
    </group>
  );
};


interface IsoMapProps {
  grid: Grid;
  onTileClick: (x: number, y: number, rotation?: number) => void;
  hoveredTool: BuildingType | null;
  stats: CityStats;
  floatingTexts?: FloatingTextData[];
}

const FloatingLabels = ({ texts }: { texts: FloatingTextData[] }) => {
  return (
    <>
      {texts.map((t) => {
         const pos = gridToWorld(t.x, t.y);
         return (
           <group key={t.id} position={[pos[0], 2, pos[2]]}>
             <Html center zIndexRange={[100, 0]}>
               <div className="font-bold text-lg select-none whitespace-nowrap animate-float-up pointer-events-none drop-shadow-md" style={{ color: t.color }}>
                 {t.text}
               </div>
             </Html>
           </group>
         );
      })}
    </>
  );
}

const IsoMap: React.FC<IsoMapProps> = ({ grid, onTileClick, hoveredTool, stats, floatingTexts = [] }) => {
  const [hoveredTile, setHoveredTile] = useState<{x: number, y: number} | null>(null);

  const handleHover = useCallback((x: number, y: number) => {
    setHoveredTile({ x, y });
  }, []);

  const handleLeave = useCallback(() => {
    setHoveredTile(null);
  }, []);

  // Preview Logic
  const actToolConf = hoveredTool ? BUILDINGS[hoveredTool] : null;
  const isBulldoze = hoveredTool === BuildingType.None;
  const showBuyPreview = hoveredTile && grid[hoveredTile.y]?.[hoveredTile.x] && !grid[hoveredTile.y][hoveredTile.x].unlocked && hoveredTool === BuildingType.BuyLand;
  
  let canPlacePreview = false;
  let isPreviewOob = false;
  let bWidth = 1, bHeight = 1;
  let cursorX = hoveredTile?.x || 0;
  let cursorY = hoveredTile?.y || 0;

  if (hoveredTile && actToolConf && !isBulldoze && hoveredTool !== BuildingType.BuyLand) {
     bWidth = actToolConf.width || 1;
     bHeight = actToolConf.height || 1;
     canPlacePreview = true;
     for (let dy=0; dy<bHeight; dy++) {
       for (let dx=0; dx<bWidth; dx++) {
         const t = grid[hoveredTile.y + dy]?.[hoveredTile.x + dx];
         if (!t) {
            isPreviewOob = true;
            canPlacePreview = false;
         } else if (t.buildingType !== BuildingType.None || !t.unlocked) {
            canPlacePreview = false;
         }
       }
     }
  }

  // Handle Bulldoze cursor bounds
  if (isBulldoze && hoveredTile) {
     const t = grid[hoveredTile.y]?.[hoveredTile.x];
     if (t && t.buildingType !== BuildingType.None) {
        cursorX = t.originX ?? hoveredTile.x;
        cursorY = t.originY ?? hoveredTile.y;
        const tgtConf = BUILDINGS[t.buildingType];
        bWidth = tgtConf?.width || 1;
        bHeight = tgtConf?.height || 1;
     }
  }

  const showPreview = hoveredTile && actToolConf && !isBulldoze && hoveredTool !== BuildingType.BuyLand && !isPreviewOob;
  const previewColor = showPreview ? (canPlacePreview ? actToolConf.color : '#ef4444') : 'white';
  const cursorColor = isBulldoze ? '#ef4444' : (showPreview ? (canPlacePreview ? '#22c55e' : '#ef4444') : '#ffffff');
  
  const previewPos = showPreview ? gridToWorld(cursorX + (bWidth - 1) / 2, cursorY + (bHeight - 1) / 2) : [0,0,0];

  return (
    <div className="absolute inset-0 bg-slate-900 touch-none">
      <Canvas shadows={false} dpr={[1, 1]} gl={{ antialias: false, powerPreference: "high-performance" }}>
        <OrthographicCamera makeDefault zoom={25} position={[40, 40, 40]} near={-100} far={200} />
        
        <MapControls 
          makeDefault
          enableRotate={true}
          enableZoom={true}
          enableDamping={true}
          dampingFactor={0.05}
          minZoom={12}
          maxZoom={100}
          maxPolarAngle={Math.PI / 2.5}
          minPolarAngle={0.1}
          target={[0,-0.5,0]}
          touches={{
            ONE: THREE.TOUCH.PAN,
            TWO: THREE.TOUCH.DOLLY_ROTATE
          }}
          mouseButtons={{
            LEFT: THREE.MOUSE.PAN,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.ROTATE
          }}
        />
        <CameraController />

        <EnvironmentSystem />
        
        <Environment preset="city" />

        <EnvironmentEffects />

        <group>
          {/* Invisible plane for interactions covering the entire grid */}
          <mesh 
            rotation={[-Math.PI / 2, 0, 0]} 
            position={[0, -0.3, 0]} 
            visible={false}
            onPointerMove={(e) => {
               e.stopPropagation();
               // Simple inverse of projection. Our grid maps x, y to wx, wz.
               // gridToWorld roughly multiplies by 1 for width. The origin is centered.
               const originX = (GRID_SIZE - 1) / 2;
               const originZ = (GRID_SIZE - 1) / 2;
               
               // Our grid scaling is simply 1x1 size units, and position comes from:
               // wx = (x - originX) * 1;
               // wz = (y - originZ) * 1;
               
               const rawX = e.point.x + originX;
               const rawY = e.point.z + originZ;
               
               const ax = Math.round(rawX);
               const ay = Math.round(rawY);
               
               if (ax >= 0 && ax < GRID_SIZE && ay >= 0 && ay < GRID_SIZE) {
                   handleHover(ax, ay);
               } else {
                   handleLeave();
               }
            }}
            onPointerOut={() => handleLeave()}
            onClick={(e) => {
               e.stopPropagation();
               const originX = (GRID_SIZE - 1) / 2;
               const originZ = (GRID_SIZE - 1) / 2;
               const ax = Math.round(e.point.x + originX);
               const ay = Math.round(e.point.z + originZ);
               if (ax >= 0 && ax < GRID_SIZE && ay >= 0 && ay < GRID_SIZE) {
                   const rotation = getSnappedCameraAngle(e.camera);
                   onTileClick(ax, ay, rotation);
               }
            }}
          >
             <planeGeometry args={[GRID_SIZE * 2, GRID_SIZE * 2]} />
             <meshBasicMaterial />
          </mesh>

          <GroundInstances grid={grid} hoveredTool={hoveredTool} />
          {(() => {
             const elements = [];
             for (let y = 0; y < GRID_SIZE; y++) {
               for (let x = 0; x < GRID_SIZE; x++) {
                 const tile = grid[y][x];
                 if (tile.buildingType !== BuildingType.None) {
                     if (tile.buildingType === BuildingType.Road) {
                         const [wx, _, wz] = gridToWorld(x, y);
                         elements.push(
                           <group key={`road-${x}-${y}`} position={[wx, 0, wz]}>
                               <RoadMarkings x={x} y={y} grid={grid} yOffset={-0.289} />
                           </group>
                         );
                     } else if (tile.unlocked) {
                         // Only render once for multi-tile buildings
                         if ((tile.originX === undefined && tile.originY === undefined) || (tile.originX === x && tile.originY === y)) {
                             const conf = BUILDINGS[tile.buildingType];
                             const bw = conf?.width || 1;
                             const bh = conf?.height || 1;
                             const [wx, _, wz] = gridToWorld(x + (bw - 1) / 2, y + (bh - 1) / 2);
                             elements.push(
                               <group key={`${x}-${y}`} position={[wx, 0, wz]} raycast={() => null}>
                                  <ProceduralBuilding 
                                    type={tile.buildingType} 
                                    baseColor={conf.color} 
                                    x={x} y={y} 
                                    rotation={tile.rotation}
                                  />
                               </group>
                             );
                         }
                     }
                 }
               }
             }
             return elements;
          })()}

          {/* Visual Elements - disable pointer events */}
          <group raycast={() => null}>
            <TrafficSystem grid={grid} />
            <PopulationSystem population={stats.population} grid={grid} />

            {/* Chunk Buy Highlight */}
            {showBuyPreview && hoveredTile && (() => {
               const cx = Math.floor(hoveredTile.x / CHUNK_SIZE) * CHUNK_SIZE + Math.floor(CHUNK_SIZE/2);
               const cy = Math.floor(hoveredTile.y / CHUNK_SIZE) * CHUNK_SIZE + Math.floor(CHUNK_SIZE/2);
               const [cwx, _, cwz] = gridToWorld(cx, cy);
               return (
                  <mesh position={[cwx, -0.2, cwz]} rotation={[-Math.PI / 2, 0, 0]}>
                    <planeGeometry args={[CHUNK_SIZE, CHUNK_SIZE]} />
                    <meshBasicMaterial color="#22c55e" transparent opacity={0.3} side={THREE.DoubleSide} />
                  </mesh>
               );
            })()}

            {/* Placement Preview */}
            {showPreview && hoveredTile && hoveredTool !== null && (
              <PreviewBuilding 
                type={hoveredTool} 
                color={previewColor} 
                x={cursorX} 
                y={cursorY} 
                position={[previewPos[0], 0, previewPos[2]]}
              />
            )}

            {/* Highlight */}
            {hoveredTile && (
              <Cursor 
                x={cursorX} 
                y={cursorY} 
                width={bWidth}
                height={bHeight}
                color={cursorColor} 
              />
            )}

            {/* Floating Economy Texts */}
            <FloatingLabels texts={floatingTexts} />
          </group>
        </group>
      </Canvas>
    </div>
  );
};

export default IsoMap;