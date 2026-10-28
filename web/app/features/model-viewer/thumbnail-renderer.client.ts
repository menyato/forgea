import {
  Box3,
  CylinderGeometry,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { loadModel, paint, studioEnvironment } from './model-assets.client';
import type { SceneColors } from './theme-colors';

export interface PreparedModel {
  model: Object3D;
  center: Vector3;
  radius: number;
  bottom: number;
}

/**
 * Draws product models for the shop's cards. Browsers allow only a few WebGL contexts per
 * page (about 16), so every card shares this one: it renders a frame here and copies the
 * pixels into the card's own 2D canvas.
 */
export class ThumbnailRenderer {
  private readonly renderer = new WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(30, 4 / 3, 1, 10_000);
  private readonly plate = new Mesh(
    new CylinderGeometry(1, 1, 0.04, 64),
    // Dimmer reflections than the model, so the plate stays visible on a white card.
    new MeshStandardMaterial({ roughness: 0.9, envMapIntensity: 0.35 }),
  );
  private readonly prepared = new Map<string, Promise<PreparedModel>>();

  constructor() {
    this.scene.environment = studioEnvironment(this.renderer);
    this.scene.environmentIntensity = 0.6;
    const key = new DirectionalLight('#ffffff', 1.4);
    key.position.set(2, 4, 3);
    const rim = new DirectionalLight('#ffffff', 0.9);
    rim.position.set(-3, 2, -4);
    this.scene.add(key, rim, this.plate);
  }

  /** Loads (once per model and colour) and measures a model for framing. */
  prepare(modelKey: string, color: string): Promise<PreparedModel> {
    const id = `${modelKey}|${color}`;
    let pending = this.prepared.get(id);
    if (!pending) {
      pending = loadModel(modelKey, 'lite').then((model) => {
        paint(model, color);
        const box = new Box3().setFromObject(model);
        const center = box.getCenter(new Vector3());
        return {
          model,
          center,
          radius: Math.max(box.getSize(new Vector3()).length() / 2, 1e-3),
          bottom: box.min.y,
        };
      });
      pending.catch(() => this.prepared.delete(id));
      this.prepared.set(id, pending);
    }
    return pending;
  }

  /** Renders the model turned by `angle` (radians) into the card's canvas. */
  draw(
    target: HTMLCanvasElement,
    p: PreparedModel,
    angle: number,
    colors: SceneColors,
  ): void {
    const { width, height } = target;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;

    const distance = p.radius / Math.sin((this.camera.fov * Math.PI) / 360);
    const turn = angle + Math.PI / 4;
    this.camera.position.set(
      p.center.x + Math.sin(turn) * distance * 0.95,
      p.center.y + distance * 0.45,
      p.center.z + Math.cos(turn) * distance * 0.95,
    );
    this.camera.near = distance / 100;
    this.camera.far = distance * 100;
    this.camera.lookAt(p.center);
    this.camera.updateProjectionMatrix();

    (this.plate.material as MeshStandardMaterial).color.set(colors.plate);
    this.plate.scale.set(p.radius * 0.95, p.radius, p.radius * 0.95);
    this.plate.position.set(p.center.x, p.bottom - p.radius * 0.02, p.center.z);

    this.scene.add(p.model);
    this.renderer.render(this.scene, this.camera);
    this.scene.remove(p.model);

    const ctx = target.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(this.renderer.domElement, 0, 0);
  }
}

let instance: ThumbnailRenderer | null = null;

/** The page's one renderer, created on first use. Throws when WebGL is unavailable. */
export function thumbnailRenderer(): ThumbnailRenderer {
  return (instance ??= new ThumbnailRenderer());
}
