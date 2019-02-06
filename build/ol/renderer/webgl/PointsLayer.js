/**
 * @module ol/renderer/webgl/PointsLayer
 */
import LayerRenderer from '../Layer';
import WebGLArrayBuffer from '../../webgl/Buffer';
import {DYNAMIC_DRAW, ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER, FLOAT} from '../../webgl';
import WebGLHelper, {DefaultAttrib, DefaultUniform} from '../../webgl/Helper';
import WebGLVertex from '../../webgl/Vertex';
import WebGLFragment from '../../webgl/Fragment';
import GeometryType from '../../geom/GeometryType';

var VERTEX_SHADER = "\n  precision mediump float;\n  attribute vec2 a_position;\n  attribute vec2 a_texCoord;\n  attribute float a_rotateWithView;\n  attribute vec2 a_offsets;\n  \n  uniform mat4 u_projectionMatrix;\n  uniform mat4 u_offsetScaleMatrix;\n  uniform mat4 u_offsetRotateMatrix;\n  \n  varying vec2 v_texCoord;\n  \n  void main(void) {\n    mat4 offsetMatrix = u_offsetScaleMatrix;\n    if (a_rotateWithView == 1.0) {\n      offsetMatrix = u_offsetScaleMatrix * u_offsetRotateMatrix;\n    }\n    vec4 offsets = offsetMatrix * vec4(a_offsets, 0.0, 0.0);\n    gl_Position = u_projectionMatrix * vec4(a_position, 0.0, 1.0) + offsets;\n    v_texCoord = a_texCoord;\n  }";

var FRAGMENT_SHADER = "\n  precision mediump float;\n  uniform float u_opacity;\n  \n  varying vec2 v_texCoord;\n  \n  void main(void) {\n    gl_FragColor.rgb = vec3(1.0, 1.0, 1.0);\n    float alpha = u_opacity;\n    if (alpha == 0.0) {\n      discard;\n    }\n    gl_FragColor.a = alpha;\n  }";

/**
 * @typedef {Object} PostProcessesOptions
 * @property {number} [scaleRatio] Scale ratio; if < 1, the post process will render to a texture smaller than
 * the main canvas that will then be sampled up (useful for saving resource on blur steps).
 * @property {string} [vertexShader] Vertex shader source
 * @property {string} [fragmentShader] Fragment shader source
 * @property {Object.<string,import("../../webgl/Helper").UniformValue>} [uniforms] Uniform definitions for the post process step
 */

/**
 * @typedef {Object} Options
 * @property {function(import("../../Feature").default):number} [sizeCallback] Will be called on every feature in the
 * source to compute the size of the quad on screen (in pixels). This only done on source change.
 * @property {function(import("../../Feature").default, number):number} [coordCallback] Will be called on every feature in the
 * source to compute the coordinate of the quad center on screen (in pixels). This only done on source change.
 * The second argument is 0 for `x` component and 1 for `y`.
 * @property {string} [vertexShader] Vertex shader source
 * @property {string} [fragmentShader] Fragment shader source
 * @property {Object.<string,import("../../webgl/Helper").UniformValue>} [uniforms] Uniform definitions for the post process steps
 * @property {Array<PostProcessesOptions>} [postProcesses] Post-processes definitions
 */

/**
 * @classdesc
 * WebGL vector renderer optimized for points.
 * All features will be rendered as quads (two triangles forming a square). New data will be flushed to the GPU
 * every time the vector source changes.
 *
 * Use shaders to customize the final output.
 *
 * This uses {@link module:ol/webgl/Helper~WebGLHelper} internally.
 *
 * Default shaders are shown hereafter:
 *
 * * Vertex shader:
 *   ```
 *   precision mediump float;
 *   attribute vec2 a_position;
 *   attribute vec2 a_texCoord;
 *   attribute float a_rotateWithView;
 *   attribute vec2 a_offsets;
 *
 *   uniform mat4 u_projectionMatrix;
 *   uniform mat4 u_offsetScaleMatrix;
 *   uniform mat4 u_offsetRotateMatrix;
 *
 *   varying vec2 v_texCoord;
 *
 *   void main(void) {
 *     mat4 offsetMatrix = u_offsetScaleMatrix;
 *     if (a_rotateWithView == 1.0) {
 *       offsetMatrix = u_offsetScaleMatrix * u_offsetRotateMatrix;
 *     }
 *     vec4 offsets = offsetMatrix * vec4(a_offsets, 0.0, 0.0);
 *     gl_Position = u_projectionMatrix * vec4(a_position, 0.0, 1.0) + offsets;
 *     v_texCoord = a_texCoord;
 *   }
 *   ```
 *
 * * Fragment shader:
 *   ```
 *   precision mediump float;
 *   uniform float u_opacity;
 *
 *   varying vec2 v_texCoord;
 *
 *   void main(void) {
 *     gl_FragColor.rgb = vec3(1.0, 1.0, 1.0);
 *     float alpha = u_opacity;
 *     if (alpha == 0.0) {
 *       discard;
 *     }
 *     gl_FragColor.a = alpha;
 *   }
 *   ```
 *
 * @api
 */
var WebGLPointsLayerRenderer = /*@__PURE__*/(function (LayerRenderer) {
  function WebGLPointsLayerRenderer(vectorLayer, opt_options) {
    LayerRenderer.call(this, vectorLayer);

    var options = opt_options || {};

    this.context_ = new WebGLHelper({
      postProcesses: options.postProcesses,
      uniforms: options.uniforms
    });

    this.sourceRevision_ = -1;

    this.verticesBuffer_ = new WebGLArrayBuffer([], DYNAMIC_DRAW);
    this.indicesBuffer_ = new WebGLArrayBuffer([], DYNAMIC_DRAW);

    var vertexShader = new WebGLVertex(options.vertexShader || VERTEX_SHADER);
    var fragmentShader = new WebGLFragment(options.fragmentShader || FRAGMENT_SHADER);
    this.program_ = this.context_.getProgram(fragmentShader, vertexShader);
    this.context_.useProgram(this.program_);

    this.sizeCallback_ = options.sizeCallback || function(feature) {
      return 1;
    };
    this.coordCallback_ = options.coordCallback || function(feature, index) {
      var geom = /** @type {import("../../geom/Point").default} */ (feature.getGeometry());
      return geom.getCoordinates()[index];
    };
  }

  if ( LayerRenderer ) WebGLPointsLayerRenderer.__proto__ = LayerRenderer;
  WebGLPointsLayerRenderer.prototype = Object.create( LayerRenderer && LayerRenderer.prototype );
  WebGLPointsLayerRenderer.prototype.constructor = WebGLPointsLayerRenderer;

  /**
   * @inheritDoc
   */
  WebGLPointsLayerRenderer.prototype.disposeInternal = function disposeInternal () {
    LayerRenderer.prototype.disposeInternal.call(this);
  };

  /**
   * @inheritDoc
   */
  WebGLPointsLayerRenderer.prototype.renderFrame = function renderFrame (frameState, layerState) {
    this.context_.setUniformFloatValue(DefaultUniform.OPACITY, layerState.opacity);
    this.context_.drawElements(0, this.indicesBuffer_.getArray().length);
    this.context_.finalizeDraw(frameState);
    return this.context_.getCanvas();
  };

  /**
   * @inheritDoc
   */
  WebGLPointsLayerRenderer.prototype.prepareFrame = function prepareFrame (frameState) {
    var this$1 = this;

    var vectorLayer = /** @type {import("../../layer/Vector.js").default} */ (this.getLayer());
    var vectorSource = /** @type {import("../../source/Vector.js").default} */ (vectorLayer.getSource());

    this.context_.prepareDraw(frameState);

    if (this.sourceRevision_ < vectorSource.getRevision()) {
      this.sourceRevision_ = vectorSource.getRevision();

      var viewState = frameState.viewState;
      var projection = viewState.projection;
      var resolution = viewState.resolution;

      // loop on features to fill the buffer
      vectorSource.loadFeatures([-Infinity, -Infinity, Infinity, Infinity], resolution, projection);
      vectorSource.forEachFeature(function (feature) {
        if (!feature.getGeometry() || feature.getGeometry().getType() !== GeometryType.POINT) {
          return;
        }
        var x = this$1.coordCallback_(feature, 0);
        var y = this$1.coordCallback_(feature, 1);
        var size = this$1.sizeCallback_(feature);
        var stride = 6;
        var baseIndex = this$1.verticesBuffer_.getArray().length / stride;

        this$1.verticesBuffer_.getArray().push(
          x, y, -size / 2, -size / 2, 0, 0,
          x, y, +size / 2, -size / 2, 1, 0,
          x, y, +size / 2, +size / 2, 1, 1,
          x, y, -size / 2, +size / 2, 0, 1
        );
        this$1.indicesBuffer_.getArray().push(
          baseIndex, baseIndex + 1, baseIndex + 3,
          baseIndex + 1, baseIndex + 2, baseIndex + 3
        );
      });
    }

    // write new data
    this.context_.bindBuffer(ARRAY_BUFFER, this.verticesBuffer_);
    this.context_.bindBuffer(ELEMENT_ARRAY_BUFFER, this.indicesBuffer_);

    var bytesPerFloat = Float32Array.BYTES_PER_ELEMENT;
    this.context_.enableAttributeArray(DefaultAttrib.POSITION, 2, FLOAT, bytesPerFloat * 6, 0);
    this.context_.enableAttributeArray(DefaultAttrib.OFFSETS, 2, FLOAT, bytesPerFloat * 6, bytesPerFloat * 2);
    this.context_.enableAttributeArray(DefaultAttrib.TEX_COORD, 2, FLOAT, bytesPerFloat * 6, bytesPerFloat * 4);

    return true;
  };

  return WebGLPointsLayerRenderer;
}(LayerRenderer));

export default WebGLPointsLayerRenderer;

//# sourceMappingURL=PointsLayer.js.map