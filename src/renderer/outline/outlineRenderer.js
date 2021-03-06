/**
 * @author xeolabs / https://github.com/xeolabs
 */

(function () {

    "use strict";

    var ids = new xeogl.utils.Map({});

    xeogl.renderer.OutlineRenderer = function (hash, mesh) {
        this._init(hash, mesh);
    };

    var outlineRenderers = {};

    xeogl.renderer.OutlineRenderer.get = function (mesh) {
        var hash = [
            mesh.scene.canvas.canvas.id,
            mesh.scene.gammaOutput ? "go" : "", // Gamma input not needed
            mesh.scene._clipsState.getHash(),
            mesh._geometry._state.hash,
            mesh._state.hash
        ].join(";");
        var renderer = outlineRenderers[hash];
        if (!renderer) {
            renderer = new xeogl.renderer.OutlineRenderer(hash, mesh);
            outlineRenderers[hash] = renderer;
            xeogl.stats.memory.programs++;
        }
        renderer._useCount++;
        return renderer;
    };

    xeogl.renderer.OutlineRenderer.prototype.put = function () {
        if (--this._useCount === 0) {
            ids.removeItem(this.id);
            this._program.destroy();
            delete outlineRenderers[this._hash];
            xeogl.stats.memory.programs--;
        }
    };

    xeogl.renderer.OutlineRenderer.prototype._init = function (hash, mesh) {
        this.id = ids.addItem({});
        this._scene = mesh.scene;
        this._hash = hash;
        this._shaderSource = new xeogl.renderer.OutlineShaderSource(mesh);
        this._program = new xeogl.renderer.Program(mesh.scene.canvas.gl, this._shaderSource);
        this._useCount = 0;
        if (this._program.errors) {
            this.errors = this._program.errors;
            return;
        }
        var program = this._program;
        this._uPositionsDecodeMatrix = program.getLocation("positionsDecodeMatrix");
        this._uModelMatrix = program.getLocation("modelMatrix");
        this._uViewMatrix = program.getLocation("viewMatrix");
        this._uProjMatrix = program.getLocation("projMatrix");
        this._uClips = [];
        var clips = mesh.scene._clipsState.clips;
        for (var i = 0, len = clips.length; i < len; i++) {
            this._uClips.push({
                active: program.getLocation("clipActive" + i),
                pos: program.getLocation("clipPos" + i),
                dir: program.getLocation("clipDir" + i)
            });
        }
        this._uColor = program.getLocation("color");
        this._uWidth = program.getLocation("width");
        this._aPosition = program.getAttribute("position");
        this._aNormal = program.getAttribute("normal");
        this._uClippable = program.getLocation("clippable");
        this._uGammaFactor = program.getLocation("gammaFactor");
        this._lastMaterialId = null;
        this._lastVertexBufsId = null;
        this._lastGeometryId = null;
    };

    xeogl.renderer.OutlineRenderer.prototype._bindProgram = function (frame) {
        var scene = this._scene;
        var gl = scene.canvas.gl;
        var program = this._program;
        var clipsState = scene._clipsState;
        program.bind();
        frame.useProgram++;
        this._lastMaterialId = null;
        this._lastVertexBufsId = null;
        this._lastGeometryId = null;
        gl.uniformMatrix4fv(this._uViewMatrix, false, scene.viewTransform.matrix);
        gl.uniformMatrix4fv(this._uProjMatrix, false, scene.projTransform.matrix);
        if (clipsState.clips.length > 0) {
            var clipUniforms;
            var uClipActive;
            var clip;
            var uClipPos;
            var uClipDir;
            for (var i = 0, len = this._uClips.length; i < len; i++) {
                clipUniforms = this._uClips[i];
                uClipActive = clipUniforms.active;
                clip = clipsState.clips[i];
                if (uClipActive) {
                    gl.uniform1i(uClipActive, clip.active);
                }
                uClipPos = clipUniforms.pos;
                if (uClipPos) {
                    gl.uniform3fv(clipUniforms.pos, clip.pos);
                }
                uClipDir = clipUniforms.dir;
                if (uClipDir) {
                    gl.uniform3fv(clipUniforms.dir, clip.dir);
                }
            }
        }
        if (this._uGammaFactor) {
            gl.uniform1f(this._uGammaFactor, scene.gammaFactor);
        }
    };

    xeogl.renderer.OutlineRenderer.prototype.drawMesh = function (frame, mesh) {
        var scene = this._scene;
        var gl = scene.canvas.gl;
        var materialState = mesh.outlineMaterial;
        var meshState = mesh._state;
        var geometryState = mesh._geometry._state;
        if (frame.lastProgramId !== this._program.id) {
            frame.lastProgramId = this._program.id;
            this._bindProgram(frame);
        }
        if (materialState.id !== this._lastMaterialId) {
            if (this._uWidth) {
                gl.uniform1f(this._uWidth, materialState.width);
            }
            if (this._uColor) {
                var color = materialState.color;
                var alpha = materialState.alpha;
                gl.uniform4f(this._uColor, color[0], color[1], color[2], alpha);
            }
            this._lastMaterialId = materialState.id;
        }
        gl.uniformMatrix4fv(this._uModelMatrix, gl.FALSE, mesh.worldMatrix);
        if (this._uModelNormalMatrix) {
            gl.uniformMatrix4fv(this._uModelNormalMatrix, gl.FALSE, mesh.worldNormalMatrix);
        }
        if (this._uClippable) {
            gl.uniform1i(this._uClippable, meshState.clippable);
        }
        if (geometryState.combined) {
            var vertexBufs = mesh._geometry._getVertexBufs();
            if (vertexBufs.id !== this._lastVertexBufsId) {
                if (vertexBufs.positionsBuf && this._aPosition) {
                    this._aPosition.bindArrayBuffer(vertexBufs.positionsBuf, vertexBufs.quantized ? gl.UNSIGNED_SHORT : gl.FLOAT);
                    frame.bindArray++;
                }
                if (vertexBufs.normalsBuf && this._aNormal) {
                    this._aNormal.bindArrayBuffer(vertexBufs.normalsBuf, vertexBufs.quantized ? gl.BYTE : gl.FLOAT);
                    frame.bindArray++;
                }
                this._lastVertexBufsId = vertexBufs.id;
            }
        }
        // Bind VBOs
        if (geometryState.id !== this._lastGeometryId) {
            if (this._uPositionsDecodeMatrix) {
                gl.uniformMatrix4fv(this._uPositionsDecodeMatrix, false, geometryState.positionsDecodeMatrix);
            }
            if (this._uUVDecodeMatrix) {
                gl.uniformMatrix3fv(this._uUVDecodeMatrix, false, geometryState.uvDecodeMatrix);
            }
            if (geometryState.combined) { // VBOs were bound by the VertexBufs logic above
                if (geometryState.indicesBufCombined) {
                    geometryState.indicesBufCombined.bind();
                    frame.bindArray++;
                }
            } else {
                if (this._aPosition) {
                    this._aPosition.bindArrayBuffer(geometryState.positionsBuf, geometryState.quantized ? gl.UNSIGNED_SHORT : gl.FLOAT);
                    frame.bindArray++;
                }
                if (this._aNormal) {
                    this._aNormal.bindArrayBuffer(geometryState.normalsBuf, geometryState.quantized ? gl.BYTE : gl.FLOAT);
                    frame.bindArray++;
                }
                if (geometryState.indicesBuf) {
                    geometryState.indicesBuf.bind();
                    frame.bindArray++;
                    // gl.drawElements(geometryState.primitive, geometryState.indicesBuf.numItems, geometryState.indicesBuf.itemType, 0);
                    // frame.drawElements++;
                } else if (geometryState.positions) {
                    // gl.drawArrays(gl.TRIANGLES, 0, geometryState.positions.numItems);
                    //  frame.drawArrays++;
                }
            }
            this._lastGeometryId = geometryState.id;
        }
        // Draw (indices bound in prev step)
        if (geometryState.combined) {
            if (geometryState.indicesBufCombined) { // Geometry indices into portion of uber-array
                gl.drawElements(geometryState.primitive, geometryState.indicesBufCombined.numItems, geometryState.indicesBufCombined.itemType, 0);
                frame.drawElements++;
            } else {
                // TODO: drawArrays() with VertexBufs positions
            }
        } else {
            if (geometryState.indicesBuf) {
                gl.drawElements(geometryState.primitive, geometryState.indicesBuf.numItems, geometryState.indicesBuf.itemType, 0);
                frame.drawElements++;
            } else if (geometryState.positions) {
                gl.drawArrays(gl.TRIANGLES, 0, geometryState.positions.numItems);
                frame.drawArrays++;
            }
        }
    };
})();
