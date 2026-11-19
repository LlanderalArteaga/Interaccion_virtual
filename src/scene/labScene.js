import * as THREE from 'three';
import { createTextPlane } from '../ui/canvasUi.js';
import {
	CANNON,
	createBoxBody,
	createPyramidShape,
	createPhysicsWorld,
	createRoundPrismShape,
	resetDynamicBody,
	stepPhysics,
	syncPhysicsMeshes
} from '../physics/physicsWorld.js';

export const TABLETOP_Y = 0.75;
const TABLE_SIZE = 0.68;
const OBJECT_MASS_KG = 0.18;
const CATEGORY_SPECS = Object.freeze([
	{ id: 'cube', name: 'CUBO', color: 0xe7a36d, geometry: () => new THREE.BoxGeometry(0.13, 0.13, 0.13), shape: () => new CANNON.Box(new CANNON.Vec3(0.065, 0.065, 0.065)), halfHeight: 0.065, radius: 0.092 },
	{ id: 'sphere', name: 'ESFERA', color: 0x74c8dc, geometry: () => new THREE.SphereGeometry(0.071, 16, 12), shape: () => new CANNON.Sphere(0.071), halfHeight: 0.071, radius: 0.071 },
	{ id: 'pyramid', name: 'PIRÁMIDE', color: 0xc0a0f2, geometry: () => new THREE.ConeGeometry(0.078, 0.15, 4), shape: () => createPyramidShape(0.078, 0.15), halfHeight: 0.075, radius: 0.078 },
	{ id: 'hex-prism', name: 'PRISMA HEXAGONAL', color: 0xf0cf76, geometry: () => new THREE.CylinderGeometry(0.073, 0.073, 0.15, 6), shape: () => createRoundPrismShape(0.073, 0.15, 6), halfHeight: 0.075, radius: 0.073 }
]);

const STATIONS = Object.freeze([
	{ id: 'north-west', x: 0.33, z: -0.85, rotation: 0 },
	{ id: 'north-east', x: 1.05, z: -0.85, rotation: 0 },
	{ id: 'south-west', x: 0.33, z: -1.55, rotation: 0 },
	{ id: 'south-east', x: 1.05, z: -1.55, rotation: 0 }
]);

const OBJECT_SLOTS = Object.freeze([
	{ x: -0.22, z: -0.11 }, { x: 0, z: -0.11 }, { x: 0.22, z: -0.11 },
	{ x: -0.11, z: 0.15 }, { x: 0.11, z: 0.15 }
]);

export function createLabScene(previewElement) {
	if (!previewElement) throw new Error('No se encontró el contenedor de la vista previa 3D.');
	const scene = new THREE.Scene();
	scene.background = new THREE.Color('#0b131a');
	scene.fog = new THREE.Fog('#0b131a', 5, 10);
	const camera = new THREE.PerspectiveCamera(54, 1, 0.05, 18);
	camera.position.set(0.1, 1.6, 2.4);
	camera.lookAt(0.65, 0.7, -1.1);

	const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
	renderer.setSize(previewElement.clientWidth || 640, previewElement.clientHeight || 340, false);
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.1;
	renderer.xr.enabled = true;
	renderer.xr.setReferenceSpaceType('local-floor');
	previewElement.appendChild(renderer.domElement);

	addLights(scene);
	const physicsWorld = createPhysicsWorld();
	const physicsMaterials = createPhysicsMaterials(physicsWorld);
	createRoom(scene, physicsWorld, physicsMaterials.surface);
	const stations = createStations(scene, physicsWorld, physicsMaterials.surface);
	const bins = createBins(scene, physicsWorld, physicsMaterials.surface);
	const pieces = createPieces(scene, physicsWorld, physicsMaterials.object);
	const resizeObserver = new ResizeObserver(() => {
		const width = Math.max(1, previewElement.clientWidth);
		const height = Math.max(1, previewElement.clientHeight);
		renderer.setSize(width, height, false);
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
	});
	resizeObserver.observe(previewElement);

	const app = {
		scene, camera, renderer, physicsWorld, stations, bins, pieces,
		stepPhysics(deltaSeconds) {
			stepPhysics(physicsWorld, deltaSeconds);
			syncPhysicsMeshes(pieces);
			updateRecoveryMarkers(pieces);
		},
		resetLayout() { resetPieceLayout(pieces, stations); },
		disposeLayout() { resizeObserver.disconnect(); }
	};
	resetPieceLayout(pieces, stations);
	return app;
}

function addLights(scene) {
	scene.add(new THREE.HemisphereLight(0xcde8ef, 0x28323a, 1.9));
	const key = new THREE.DirectionalLight(0xffe6cb, 2.1);
	key.position.set(-2.5, 4, 2.5);
	scene.add(key);
	const fill = new THREE.DirectionalLight(0x76c8d5, 0.8);
	fill.position.set(2, 2.5, -2);
	scene.add(fill);
}

function createPhysicsMaterials(world) {
	const surface = new CANNON.Material('laboratory-surface');
	const object = new CANNON.Material('laboratory-object');
	world.defaultContactMaterial.friction = 0.58;
	world.defaultContactMaterial.restitution = 0.3;
	world.addContactMaterial(new CANNON.ContactMaterial(object, surface, { friction: 0.66, restitution: 0.28 }));
	world.addContactMaterial(new CANNON.ContactMaterial(object, object, { friction: 0.48, restitution: 0.36 }));
	return { surface, object };
}

function createRoom(scene, world, surfaceMaterial) {
	const floor = new THREE.Mesh(
		new THREE.PlaneGeometry(5, 5),
		new THREE.MeshStandardMaterial({ color: '#18252d', roughness: 0.94 })
	);
	floor.rotation.x = -Math.PI / 2;
	floor.position.y = -0.01;
	scene.add(floor);
	const floorBody = new CANNON.Body({ mass: 0, material: surfaceMaterial });
	floorBody.addShape(new CANNON.Plane());
	floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
	floorBody.position.y = -0.01;
	world.addBody(floorBody);

	const grid = new THREE.GridHelper(5, 25, '#49616a', '#263943');
	grid.position.y = 0.003;
	grid.material.transparent = true;
	grid.material.opacity = 0.22;
	scene.add(grid);
	const wallMaterial = new THREE.MeshStandardMaterial({ color: '#101b22', roughness: 0.9, side: THREE.DoubleSide });
	addRoomWall(scene, world, wallMaterial, surfaceMaterial, { x: 0, y: 1.35, z: -2.5, width: 5, height: 2.7, horizontal: true });
	addRoomWall(scene, world, wallMaterial, surfaceMaterial, { x: 0, y: 1.35, z: 2.5, width: 5, height: 2.7, horizontal: true });
	addRoomWall(scene, world, wallMaterial, surfaceMaterial, { x: -2.5, y: 1.35, z: 0, width: 5, height: 2.7, horizontal: false });
	addRoomWall(scene, world, wallMaterial, surfaceMaterial, { x: 2.5, y: 1.35, z: 0, width: 5, height: 2.7, horizontal: false });
}

function addRoomWall(scene, world, material, surfaceMaterial, spec) {
	const wall = new THREE.Mesh(new THREE.PlaneGeometry(spec.width, spec.height), material);
	wall.position.set(spec.x, spec.y, spec.z);
	if (!spec.horizontal) wall.rotation.y = Math.PI / 2;
	scene.add(wall);
	const half = spec.horizontal
		? new CANNON.Vec3(spec.width / 2, spec.height / 2, 0.06)
		: new CANNON.Vec3(0.06, spec.height / 2, spec.width / 2);
	createBoxBody(world, { position: spec, halfExtents: half, material: surfaceMaterial });
}

function createStations(scene, world, surfaceMaterial) {
	const topMaterial = new THREE.MeshStandardMaterial({ color: '#293941', roughness: 0.68, metalness: 0.08 });
	const legMaterial = new THREE.MeshStandardMaterial({ color: '#26343a', roughness: 0.8 });
	return STATIONS.map((station, index) => {
		const group = new THREE.Group();
		group.position.set(station.x, 0, station.z);
		group.rotation.y = station.rotation;
		const top = new THREE.Mesh(new THREE.BoxGeometry(TABLE_SIZE, 0.07, TABLE_SIZE), topMaterial);
		top.position.y = TABLETOP_Y - 0.035;
		group.add(top);
		createBoxBody(world, {
			position: { x: station.x, y: TABLETOP_Y - 0.035, z: station.z },
			halfExtents: new CANNON.Vec3(TABLE_SIZE / 2, 0.035, TABLE_SIZE / 2), material: surfaceMaterial
		});
		for (const x of [-0.36, 0.36]) {
			for (const z of [-0.36, 0.36]) {
				const leg = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.70, 0.065), legMaterial);
				leg.position.set(x, 0.35, z);
				group.add(leg);
				const worldPoint = rotateLocalPoint(station, x, z);
				createBoxBody(world, {
					position: { x: worldPoint.x, y: 0.35, z: worldPoint.z },
					halfExtents: new CANNON.Vec3(0.0325, 0.35, 0.0325), material: surfaceMaterial
				});
			}
		}
		const label = createTextPlane(`MESA ${index + 1}`, { worldWidth: 0.34, worldHeight: 0.06, fontSize: 34, background: 'rgba(12, 20, 26, 0.96)', color: '#e8efeb' });
		label.position.set(0, TABLETOP_Y + 0.12, -0.35);
		group.add(label);
		scene.add(group);
		return { ...station, id: `table-${index + 1}`, size: TABLE_SIZE, topY: TABLETOP_Y, group };
	});
}

function createBins(scene, world, surfaceMaterial) {
	const positions = [
		{ x: -0.50, z: -0.27 }, { x: 0.02, z: -0.27 },
		{ x: 0.54, z: -0.27 }, { x: 1.00, z: -0.27 }
	];
	return CATEGORY_SPECS.map((category, index) => {
		const position = positions[index];
		const group = new THREE.Group();
		group.position.set(position.x, 0, position.z);
		const standMaterial = new THREE.MeshStandardMaterial({ color: '#283940', roughness: 0.78 });
		const innerHalf = category.id === 'pyramid' ? 0.17 : 0.19;
		const wallHeight = category.id === 'pyramid' ? 0.36 : 0.38;
		const wallThickness = 0.025;
		const outerHalf = innerHalf + wallThickness;
		const standSize = outerHalf * 2 + 0.04;
		const stand = new THREE.Mesh(new THREE.BoxGeometry(standSize, 0.39, standSize), standMaterial);
		stand.position.y = 0.195;
		group.add(stand);
		createBoxBody(world, {
			position: { x: position.x, y: 0.195, z: position.z },
			halfExtents: new CANNON.Vec3(standSize / 2, 0.195, standSize / 2), material: surfaceMaterial
		});

		const baseY = 0.39;
		const baseThickness = 0.04;
		const bodyMaterial = new THREE.MeshStandardMaterial({ color: category.color, roughness: 0.42, metalness: 0.08, transparent: true, opacity: 0.78, side: THREE.DoubleSide });
		addBinPart(group, world, surfaceMaterial, bodyMaterial, position, 0, baseY + baseThickness / 2, 0, innerHalf * 2 + wallThickness * 2, baseThickness, innerHalf * 2 + wallThickness * 2);
		addBinPart(group, world, surfaceMaterial, bodyMaterial, position, -outerHalf, baseY + baseThickness + wallHeight / 2, 0, wallThickness, wallHeight, innerHalf * 2 + wallThickness * 2);
		addBinPart(group, world, surfaceMaterial, bodyMaterial, position, outerHalf, baseY + baseThickness + wallHeight / 2, 0, wallThickness, wallHeight, innerHalf * 2 + wallThickness * 2);
		addBinPart(group, world, surfaceMaterial, bodyMaterial, position, 0, baseY + baseThickness + wallHeight / 2, -outerHalf, innerHalf * 2, wallHeight, wallThickness);
		addBinPart(group, world, surfaceMaterial, bodyMaterial, position, 0, baseY + baseThickness + wallHeight / 2, outerHalf, innerHalf * 2, wallHeight, wallThickness);

		const label = createTextPlane(category.name, { worldWidth: category.id === 'hex-prism' ? 0.42 : 0.32, worldHeight: 0.065, fontSize: 29, background: 'rgba(12, 20, 26, 0.96)', color: '#f6f3e9' });
		label.position.set(0, baseY + baseThickness + wallHeight + 0.08, 0);
		group.add(label);
		scene.add(group);
		return { id: category.id, name: category.name, color: category.color, group, position: new THREE.Vector3(position.x, baseY, position.z), innerHalf, wallHeight, floorY: baseY + baseThickness };
	});
}

function addBinPart(group, world, surfaceMaterial, visualMaterial, binPosition, localX, y, localZ, width, height, depth) {
	const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), visualMaterial);
	mesh.position.set(localX, y, localZ);
	group.add(mesh);
	createBoxBody(world, {
		position: { x: binPosition.x + localX, y, z: binPosition.z + localZ },
		halfExtents: new CANNON.Vec3(width / 2, height / 2, depth / 2), material: surfaceMaterial
	});
}

function createPieces(scene, world, objectMaterial) {
	const pieces = [];
	const recoveryRingGeometry = new THREE.TorusGeometry(0.13, 0.009, 6, 24);
	const recoveryBeamGeometry = new THREE.CylinderGeometry(0.008, 0.008, 0.52, 6);
	const recoveryMaterial = new THREE.MeshBasicMaterial({ color: '#75f5d0', transparent: true, opacity: 0.86 });
	for (const category of CATEGORY_SPECS) {
		for (let index = 0; index < 5; index += 1) {
			const root = new THREE.Group();
			const material = new THREE.MeshStandardMaterial({ color: category.color, roughness: 0.36, metalness: 0.06, emissive: '#000000', emissiveIntensity: 0.35 });
			const mesh = new THREE.Mesh(category.geometry(), material);
			mesh.castShadow = false;
			mesh.receiveShadow = true;
			mesh.userData.pieceId = `${category.id}-${index + 1}`;
			root.add(mesh);
			scene.add(root);
			const recoveryMarker = new THREE.Group();
			const ring = new THREE.Mesh(recoveryRingGeometry, recoveryMaterial);
			ring.rotation.x = -Math.PI / 2;
			const beam = new THREE.Mesh(recoveryBeamGeometry, recoveryMaterial);
			beam.position.y = 0.27;
			recoveryMarker.add(ring, beam);
			recoveryMarker.visible = false;
			scene.add(recoveryMarker);
			const body = new CANNON.Body({
				mass: OBJECT_MASS_KG,
				material: objectMaterial,
				shape: category.shape(),
				linearDamping: 0.025,
				angularDamping: 0.12,
				allowSleep: true,
				sleepSpeedLimit: 0.12,
				sleepTimeLimit: 0.65
			});
			body.updateMassProperties();
			world.addBody(body);
			pieces.push({
				id: `${category.id}-${index + 1}`,
				name: category.name,
				categoryId: category.id,
				category,
				status: 'available',
				root,
				recoveryMarker,
				mesh,
				material,
				body,
				massKg: OBJECT_MASS_KG,
				halfHeight: category.halfHeight,
				boundingRadius: category.radius,
				homeTableId: null,
				assignedBinId: category.id,
				classified: false,
				counted: false,
				restingSince: null,
				wrongFeedbackShown: false,
				startPosition: new THREE.Vector3(),
				startQuaternion: new THREE.Quaternion()
			});
		}
	}
	return pieces;
}

function resetPieceLayout(pieces, stations) {
	const shuffledPieces = shuffle([...pieces]);
	let cursor = 0;
	for (const station of stations) {
		const slots = shuffle([...OBJECT_SLOTS]);
		const quarterTurns = Math.floor(Math.random() * 4);
		for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
			const piece = shuffledPieces[cursor++];
			const slot = rotateSlot(slots[slotIndex], quarterTurns);
			const localX = slot.x + (Math.random() - 0.5) * 0.018;
			const localZ = slot.z + (Math.random() - 0.5) * 0.018;
			const worldPoint = rotateLocalPoint(station, localX, localZ);
			const position = new THREE.Vector3(worldPoint.x, TABLETOP_Y + piece.halfHeight + 0.018, worldPoint.z);
			const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.random() * Math.PI * 2, 0));
			piece.homeTableId = station.id;
			piece.status = 'available';
			piece.classified = false;
			piece.counted = false;
			piece.restingSince = null;
			piece.wrongFeedbackShown = false;
			piece.recoveryMarker.visible = false;
			piece.material.emissive.set('#000000');
			piece.body.type = CANNON.Body.DYNAMIC;
			piece.body.mass = piece.massKg;
			piece.body.updateMassProperties();
			piece.startPosition.copy(position);
			piece.startQuaternion.copy(quaternion);
			resetDynamicBody(piece.body, position, quaternion);
		}
	}
}

function updateRecoveryMarkers(pieces) {
	for (const piece of pieces) {
		const { x, y, z } = piece.body.position;
		const shouldShow = !piece.classified && piece.status !== 'held' && y < 0.24;
		piece.recoveryMarker.visible = shouldShow;
		if (shouldShow) piece.recoveryMarker.position.set(x, 0.012, z);
	}
}

function rotateSlot(slot, quarterTurns) {
	if (quarterTurns === 1) return { x: -slot.z, z: slot.x };
	if (quarterTurns === 2) return { x: -slot.x, z: -slot.z };
	if (quarterTurns === 3) return { x: slot.z, z: -slot.x };
	return slot;
}

function rotateLocalPoint(station, x, z) {
	const cosine = Math.cos(station.rotation);
	const sine = Math.sin(station.rotation);
	return {
		x: station.x + x * cosine + z * sine,
		z: station.z - x * sine + z * cosine
	};
}

function shuffle(items) {
	for (let index = items.length - 1; index > 0; index -= 1) {
		const swapIndex = Math.floor(Math.random() * (index + 1));
		[items[index], items[swapIndex]] = [items[swapIndex], items[index]];
	}
	return items;
}
