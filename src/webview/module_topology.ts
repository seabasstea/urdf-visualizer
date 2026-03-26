import { URDFRobot } from "urdf-loader";

interface TopologyNode {
    name: string;
    type: "link" | "joint";
    jointType?: string;
    children: TopologyNode[];
    x: number;
    y: number;
    width: number;
    height: number;
    subtreeWidth: number;
}

const JOINT_COLORS: Record<string, string> = {
    fixed: "#ccc",
    revolute: "#a8d5a2",
    continuous: "#7ecfc0",
    prismatic: "#f5c07a",
    floating: "#c9a8e8",
    planar: "#c9a8e8",
};

const LINK_FILL = "#d4e6f1";
const MIN_NODE_W = 60;
const LINK_NODE_H = 28;
const JOINT_NODE_H = 36;
const NODE_PADDING = 16;
const H_GAP = 20;
const V_GAP = 50;
const FONT = "12px sans-serif";
const SMALL_FONT = "10px sans-serif";
const CORNER_RADIUS = 6;

export class ModuleTopology {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private panel: HTMLElement;
    private header: HTMLElement;
    private content: HTMLElement;

    private tree: TopologyNode | null = null;

    // Pan/zoom state
    private offsetX = 0;
    private offsetY = 0;
    private scale = 1.0;
    private isPanning = false;
    private lastMouseX = 0;
    private lastMouseY = 0;

    constructor() {
        this.panel = document.getElementById("topology-panel")!;
        this.header = document.getElementById("topology-header")!;
        this.content = document.getElementById("topology-content")!;
        this.canvas = document.getElementById(
            "topology-canvas"
        ) as HTMLCanvasElement;
        this.ctx = this.canvas.getContext("2d")!;

        this.header.addEventListener("click", () => this.toggle());
        this.setupPanZoom();

        window.addEventListener("resize", () => {
            if (!this.panel.classList.contains("minimized")) {
                this.draw();
            }
        });
    }

    public update(robot: URDFRobot): void {
        this.tree = this.buildTree(robot);
        this.computeSubtreeWidths(this.tree);
        this.assignPositions(this.tree, 0, 0);
        this.fitToView();
        this.draw();
    }

    // --- Tree extraction ---

    private measureNodeWidth(name: string, isJoint: boolean): number {
        this.ctx.font = FONT;
        const nameWidth = this.ctx.measureText(name).width;
        if (isJoint) {
            this.ctx.font = SMALL_FONT;
            const typeWidth = this.ctx.measureText("continuous").width; // widest type label
            return Math.max(MIN_NODE_W, Math.max(nameWidth, typeWidth) + NODE_PADDING);
        }
        return Math.max(MIN_NODE_W, nameWidth + NODE_PADDING);
    }

    private buildTree(obj: any): TopologyNode {
        const isJoint = !!obj.isURDFJoint;
        const name = obj.name || "unnamed";
        const node: TopologyNode = {
            name,
            type: isJoint ? "joint" : "link",
            jointType: isJoint ? obj.jointType : undefined,
            children: [],
            x: 0,
            y: 0,
            width: this.measureNodeWidth(name, isJoint),
            height: isJoint ? JOINT_NODE_H : LINK_NODE_H,
            subtreeWidth: 0,
        };

        for (const child of obj.children) {
            if (child.isURDFJoint) {
                const jointNode = this.buildTree(child);
                node.children.push(jointNode);
            } else if (child.isURDFLink) {
                // Link directly under another link (shouldn't happen in valid URDF,
                // but handle gracefully)
                const linkNode = this.buildTree(child);
                node.children.push(linkNode);
            }
            // Skip non-URDF children (visuals, colliders, axes helpers, etc.)
        }

        return node;
    }

    // --- Layout ---

    private computeSubtreeWidths(node: TopologyNode): void {
        if (node.children.length === 0) {
            node.subtreeWidth = node.width;
            return;
        }

        for (const child of node.children) {
            this.computeSubtreeWidths(child);
        }

        const childrenTotalWidth = node.children.reduce(
            (sum, c) => sum + c.subtreeWidth,
            0
        );
        const gaps = H_GAP * (node.children.length - 1);
        node.subtreeWidth = Math.max(node.width, childrenTotalWidth + gaps);
    }

    private assignPositions(
        node: TopologyNode,
        centerX: number,
        topY: number
    ): void {
        node.x = centerX - node.width / 2;
        node.y = topY;

        if (node.children.length === 0) return;

        const childrenTotalWidth =
            node.children.reduce((sum, c) => sum + c.subtreeWidth, 0) +
            H_GAP * (node.children.length - 1);

        let startX = centerX - childrenTotalWidth / 2;
        const childY = topY + node.height + V_GAP;

        for (const child of node.children) {
            const childCenterX = startX + child.subtreeWidth / 2;
            this.assignPositions(child, childCenterX, childY);
            startX += child.subtreeWidth + H_GAP;
        }
    }

    private fitToView(): void {
        if (!this.tree) return;

        const bounds = this.getBounds(this.tree);
        const canvasW = this.canvas.clientWidth;
        const canvasH = this.canvas.clientHeight;

        if (canvasW === 0 || canvasH === 0) return;

        const padding = 20;
        const treeW = bounds.maxX - bounds.minX + padding * 2;
        const treeH = bounds.maxY - bounds.minY + padding * 2;

        this.scale = Math.min(
            canvasW / treeW,
            canvasH / treeH,
            1.5 // don't over-zoom small trees
        );

        this.offsetX =
            (canvasW - treeW * this.scale) / 2 -
            bounds.minX * this.scale +
            padding * this.scale;
        this.offsetY =
            (canvasH - treeH * this.scale) / 2 -
            bounds.minY * this.scale +
            padding * this.scale;
    }

    private getBounds(node: TopologyNode): {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
    } {
        let minX = node.x;
        let minY = node.y;
        let maxX = node.x + node.width;
        let maxY = node.y + node.height;

        for (const child of node.children) {
            const cb = this.getBounds(child);
            minX = Math.min(minX, cb.minX);
            minY = Math.min(minY, cb.minY);
            maxX = Math.max(maxX, cb.maxX);
            maxY = Math.max(maxY, cb.maxY);
        }

        return { minX, minY, maxX, maxY };
    }

    // --- Rendering ---

    private draw(): void {
        const dpr = window.devicePixelRatio || 1;
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;

        if (w === 0 || h === 0) return;

        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;

        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.ctx.clearRect(0, 0, w, h);

        if (!this.tree) return;

        this.ctx.save();
        this.ctx.translate(this.offsetX, this.offsetY);
        this.ctx.scale(this.scale, this.scale);

        this.drawEdges(this.tree);
        this.drawNodes(this.tree);

        this.ctx.restore();
    }

    private drawEdges(node: TopologyNode): void {
        if (node.children.length === 0) return;

        const parentCX = node.x + node.width / 2;
        const parentBottom = node.y + node.height;

        for (const child of node.children) {
            const childCX = child.x + child.width / 2;
            const childTop = child.y;
            const midY = (parentBottom + childTop) / 2;

            this.ctx.beginPath();
            this.ctx.strokeStyle = "#888";
            this.ctx.lineWidth = 1.5;
            this.ctx.moveTo(parentCX, parentBottom);
            this.ctx.lineTo(parentCX, midY);
            this.ctx.lineTo(childCX, midY);
            this.ctx.lineTo(childCX, childTop);
            this.ctx.stroke();

            this.drawEdges(child);
        }
    }

    private drawNodes(node: TopologyNode): void {
        const cx = node.x + node.width / 2;

        if (node.type === "link") {
            this.drawRoundedRect(
                node.x, node.y, node.width, node.height,
                CORNER_RADIUS, LINK_FILL, "#555"
            );
            this.ctx.fillStyle = "#000";
            this.ctx.font = FONT;
            this.ctx.textAlign = "center";
            this.ctx.textBaseline = "middle";
            this.ctx.fillText(node.name, cx, node.y + node.height / 2);
        } else {
            const fill = JOINT_COLORS[node.jointType || ""] || "#ddd";
            this.drawRoundedRect(
                node.x, node.y, node.width, node.height,
                CORNER_RADIUS, fill, "#555"
            );
            this.ctx.fillStyle = "#000";
            this.ctx.font = FONT;
            this.ctx.textAlign = "center";
            this.ctx.textBaseline = "middle";
            this.ctx.fillText(node.name, cx, node.y + node.height / 2 - 6);
            this.ctx.font = SMALL_FONT;
            this.ctx.fillStyle = "#555";
            this.ctx.fillText(node.jointType || "", cx, node.y + node.height / 2 + 8);
        }

        for (const child of node.children) {
            this.drawNodes(child);
        }
    }

    private drawRoundedRect(
        x: number,
        y: number,
        w: number,
        h: number,
        r: number,
        fill: string,
        stroke: string
    ): void {
        this.ctx.beginPath();
        this.ctx.moveTo(x + r, y);
        this.ctx.lineTo(x + w - r, y);
        this.ctx.arcTo(x + w, y, x + w, y + r, r);
        this.ctx.lineTo(x + w, y + h - r);
        this.ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        this.ctx.lineTo(x + r, y + h);
        this.ctx.arcTo(x, y + h, x, y + h - r, r);
        this.ctx.lineTo(x, y + r);
        this.ctx.arcTo(x, y, x + r, y, r);
        this.ctx.closePath();
        this.ctx.fillStyle = fill;
        this.ctx.fill();
        this.ctx.strokeStyle = stroke;
        this.ctx.lineWidth = 1;
        this.ctx.stroke();
    }

    // --- Pan/zoom ---

    private setupPanZoom(): void {
        this.canvas.addEventListener(
            "wheel",
            (e) => {
                e.preventDefault();
                e.stopPropagation();

                const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
                const newScale = Math.max(
                    0.2,
                    Math.min(3.0, this.scale * zoomFactor)
                );

                const rect = this.canvas.getBoundingClientRect();
                const mx = e.clientX - rect.left;
                const my = e.clientY - rect.top;

                this.offsetX =
                    mx - (mx - this.offsetX) * (newScale / this.scale);
                this.offsetY =
                    my - (my - this.offsetY) * (newScale / this.scale);
                this.scale = newScale;

                this.draw();
            },
            { passive: false }
        );

        this.canvas.addEventListener("pointerdown", (e) => {
            e.stopPropagation();
            this.isPanning = true;
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
            this.canvas.setPointerCapture(e.pointerId);
            this.canvas.style.cursor = "grabbing";
        });

        this.canvas.addEventListener("pointermove", (e) => {
            if (!this.isPanning) return;
            const dx = e.clientX - this.lastMouseX;
            const dy = e.clientY - this.lastMouseY;
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
            this.offsetX += dx;
            this.offsetY += dy;
            this.draw();
        });

        this.canvas.addEventListener("pointerup", (e) => {
            if (this.isPanning) {
                this.isPanning = false;
                this.canvas.releasePointerCapture(e.pointerId);
                this.canvas.style.cursor = "grab";
            }
        });

        this.canvas.style.cursor = "grab";

        // Stop propagation on panel to prevent Three.js interaction
        this.panel.addEventListener("pointerdown", (e) => e.stopPropagation());
        this.panel.addEventListener("contextmenu", (e) => e.stopPropagation());
    }

    // --- Minimize/expand ---

    private toggle(): void {
        this.panel.classList.toggle("minimized");
        if (!this.panel.classList.contains("minimized")) {
            // Redraw after expanding (canvas may have been resized)
            requestAnimationFrame(() => {
                this.fitToView();
                this.draw();
            });
        }
    }
}
