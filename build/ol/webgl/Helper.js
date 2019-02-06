/**
 * @module ol/webgl/Helper
 */
import {getUid} from '../util.js';
import {EXTENSIONS as WEBGL_EXTENSIONS} from '../webgl.js';
import Disposable from '../Disposable.js';
import {includes} from '../array.js';
import {listen, unlistenAll} from '../events.js';
import {clear} from '../obj.js';
import {ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER, TEXTURE_2D, TEXTURE_WRAP_S, TEXTURE_WRAP_T} from '../webgl.js';
import ContextEventType from '../webgl/ContextEventType.js';
import {
  create as createTransform,
  reset as resetTransform,
  rotate as rotateTransform,
  scale as scaleTransform,
  translate as translateTransform
} from '../transform';
import {create, fromTransform} from '../vec/mat4';
import WebGLPostProcessingPass from './PostProcessingPass';


/**
 * @typedef {Object} BufferCacheEntry
 * @property {import("./Buffer.js").default} buf
 * @property {WebGLBuffer} buffer
 */

/**
 * Uniform names used in the default shaders.
 * @const
 * @type {Object.<string,string>}
 */
export var DefaultUniform = {
  PROJECTION_MATRIX: 'u_projectionMatrix',
  OFFSET_SCALE_MATRIX: 'u_offsetScaleMatrix',
  OFFSET_ROTATION_MATRIX: 'u_offsetRotateMatrix',
  OPACITY: 'u_opacity'
};

/**
 * Attribute names used in the default shaders.
 * @const
 * @type {Object.<string,string>}
 */
export var DefaultAttrib = {
  POSITION: 'a_position',
  TEX_COORD: 'a_texCoord',
  OPACITY: 'a_opacity',
  ROTATE_WITH_VIEW: 'a_rotateWithView',
  OFFSETS: 'a_offsets'
};

/**
 * @typedef {number|Array<number>|HTMLCanvasElement|HTMLImageElement|HTMLVideoElement} UniformLiteralValue
 */

/**
 * Uniform value can be a number, array of numbers (2 to 4), canvas element or a callback returning
 * one of the previous types.
 * @typedef {UniformLiteralValue|function(import("../PluggableMap.js").FrameState):UniformLiteralValue} UniformValue
 */

/**
 * @typedef {Object} PostProcessesOptions
 * @property {number} [scaleRatio] Scale ratio; if < 1, the post process will render to a texture smaller than
 * the main canvas that will then be sampled up (useful for saving resource on blur steps).
 * @property {string} [vertexShader] Vertex shader source
 * @property {string} [fragmentShader] Fragment shader source
 * @property {Object.<string,UniformValue>} [uniforms] Uniform definitions for the post process step
 */

/**
 * @typedef {Object} Options
 * @property {Object.<string,UniformValue>} [uniforms] Uniform definitions; property namesmust math the uniform
 * names in the provided or default shaders.
 * @property {Array<PostProcessesOptions>} [postProcesses] Post-processes definitions
 */

/**
 * @typedef {Object} UniformInternalDescription
 * @property {string} name Name
 * @property {WebGLTexture} [texture] Texture
 * @private
 */

/**
 * @classdesc
 * This class is intended to provide low-level functions related to WebGL rendering, so that accessing
 * directly the WebGL API should not be required anymore.
 *
 * Several operations are handled by the `WebGLHelper` class:
 *
 * ### Define custom shaders and uniforms
 *
 *   *Shaders* are low-level programs executed on the GPU and written in GLSL. There are two types of shaders:
 *
 *   Vertex shaders are used to manipulate the position and attribute of *vertices* of rendered primitives (ie. corners of a square).
 *   Outputs are:
 *
 *   * `gl_Position`: position of the vertex in screen space
 *
 *   * Varyings usually prefixed with `v_` are passed on to the fragment shader
 *
 *   Fragment shaders are used to control the actual color of the pixels rawn on screen. Their only output is `gl_FragColor`.
 *
 *   Both shaders can take *uniforms* or *attributes* as input. Attributes are explained later. Uniforms are common, read-only values that
 *   can be changed at every frame and can be of type float, arrays of float or images.
 *
 *   Shaders must be compiled and assembled into a program like so:
 *   ```js
 *   // here we simply create two shaders and assemble them in a program which is then used
 *   // for subsequent rendering calls
 *   const vertexShader = new WebGLVertex(VERTEX_SHADER);
 *   const fragmentShader = new WebGLFragment(FRAGMENT_SHADER);
 *   this.program = this.context.getProgram(fragmentShader, vertexShader);
 *   this.context.useProgram(this.program);
 *   ```
 *
 *   Uniforms are defined using the `uniforms` option and can either be explicit values or callbacks taking the frame state as argument.
 *   You can also change their value along the way like so:
 *   ```js
 *   this.context.setUniformFloatValue(DefaultUniform.OPACITY, layerState.opacity);
 *   ```
 *
 * ### Defining post processing passes
 *
 *   *Post processing* describes the act of rendering primitives to a texture, and then rendering this texture to the final canvas
 *   while applying special effects in screen space.
 *   Typical uses are: blurring, color manipulation, depth of field, filtering...
 *
 *   The `WebGLHelper` class offers the possibility to define post processes at creation time using the `postProcesses` option.
 *   A post process step accepts the following options:
 *
 *   * `fragmentShader` and `vertexShader`: text literals in GLSL language that will be compiled and used in the post processing step.
 *   * `uniforms`: uniforms can be defined for the post processing steps just like for the main render.
 *   * `scaleRatio`: allows using an intermediate texture smaller or higher than the final canvas in the post processing step.
 *     This is typically used in blur steps to reduce the performance overhead by using an already downsampled texture as input.
 *
 *   The {@link module:ol/webgl/PostProcessingPass~WebGLPostProcessingPass} class is used internally, refer to its documentation for more info.
 *
 * ### Binding WebGL buffers and flushing data into them:
 *
 *   Data that must be passed to the GPU has to be transferred using `WebGLArrayBuffer` objects.
 *   A buffer has to be created only once, but must be bound everytime the data it holds is changed. Using `WebGLHelper.bindBuffer`
 *   will bind the buffer and flush the new data to the GPU.
 *
 *   For now, the `WebGLHelper` class expects {@link module:ol/webgl/Buffer~WebGLArrayBuffer} objects.
 *   ```js
 *   // at initialization phase
 *   this.verticesBuffer = new WebGLArrayBuffer([], DYNAMIC_DRAW);
 *   this.indicesBuffer = new WebGLArrayBuffer([], DYNAMIC_DRAW);
 *
 *   // at rendering phase
 *   this.context.bindBuffer(ARRAY_BUFFER, this.verticesBuffer);
 *   this.context.bindBuffer(ELEMENT_ARRAY_BUFFER, this.indicesBuffer);
 *   ```
 *
 * ### Specifying attributes
 *
 *   The GPU only receives the data as arrays of numbers. These numbers must be handled differently depending on what it describes (position, texture coordinate...).
 *   Attributes are used to specify these uses. Use `WebGLHelper.enableAttributeArray` and either
 *   the default attribute names in {@link module:ol/webgl/Helper~DefaultAttrib} or custom ones.
 *
 *   Please note that you will have to specify the type and offset of the attributes in the data array. You can refer to the documentation of [WebGLRenderingContext.vertexAttribPointer](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/vertexAttribPointer) for more explanation.
 *   ```js
 *   // here we indicate that the data array has the following structure:
 *   // [posX, posY, offsetX, offsetY, texCoordU, texCoordV, posX, posY, ...]
 *   let bytesPerFloat = Float32Array.BYTES_PER_ELEMENT;
 *   this.context.enableAttributeArray(DefaultAttrib.POSITION, 2, FLOAT, bytesPerFloat * 6, 0);
 *   this.context.enableAttributeArray(DefaultAttrib.OFFSETS, 2, FLOAT, bytesPerFloat * 6, bytesPerFloat * 2);
 *   this.context.enableAttributeArray(DefaultAttrib.TEX_COORD, 2, FLOAT, bytesPerFloat * 6, bytesPerFloat * 4);
 *   ```
 *
 * ### Rendering primitives
 *
 *   Once all the steps above have been achieved, rendering primitives to the screen is done using `WebGLHelper.prepareDraw` `drawElements` and `finalizeDraw`.
 *   ```js
 *   // frame preparation step
 *   this.context.prepareDraw(frameState);
 *
 *   // call this for every data array that has to be rendered on screen
 *   this.context.drawElements(0, this.indicesBuffer.getArray().length);
 *
 *   // finalize the rendering by applying post processes
 *   this.context.finalizeDraw(frameState);
 *   ```
 *
 * For an example usage of this class, refer to {@link module:ol/renderer/webgl/PointsLayer~WebGLPointsLayerRenderer}.
 *
 *
 * @api
 */
var WebGLHelper = /*@__PURE__*/(function (Disposable) {
  function WebGLHelper(opt_options) {
    Disposable.call(this);
    var options = opt_options || {};

    /**
     * @private
     * @type {HTMLCanvasElement}
     */
    this.canvas_ = document.createElement('canvas');
    this.canvas_.style.position = 'absolute';


    /**
     * @private
     * @type {WebGLRenderingContext}
     */
    this.gl_ = this.canvas_.getContext('webgl');
    var gl = this.getGL();

    /**
     * @private
     * @type {!Object<string, BufferCacheEntry>}
     */
    this.bufferCache_ = {};

    /**
     * @private
     * @type {!Object<string, WebGLShader>}
     */
    this.shaderCache_ = {};

    /**
     * @private
     * @type {!Object<string, WebGLProgram>}
     */
    this.programCache_ = {};

    /**
     * @private
     * @type {WebGLProgram}
     */
    this.currentProgram_ = null;

    /**
     * @type {boolean}
     */
    this.hasOESElementIndexUint = includes(WEBGL_EXTENSIONS, 'OES_element_index_uint');

    // use the OES_element_index_uint extension if available
    if (this.hasOESElementIndexUint) {
      gl.getExtension('OES_element_index_uint');
    }

    listen(this.canvas_, ContextEventType.LOST,
      this.handleWebGLContextLost, this);
    listen(this.canvas_, ContextEventType.RESTORED,
      this.handleWebGLContextRestored, this);

    /**
     * @private
     * @type {import("../transform.js").Transform}
     */
    this.projectionMatrix_ = createTransform();

    /**
     * @private
     * @type {import("../transform.js").Transform}
     */
    this.offsetRotateMatrix_ = createTransform();

    /**
     * @private
     * @type {import("../transform.js").Transform}
     */
    this.offsetScaleMatrix_ = createTransform();

    /**
     * @private
     * @type {Array<number>}
     */
    this.tmpMat4_ = create();

    /**
     * @private
     * @type {Object.<string, WebGLUniformLocation>}
     */
    this.uniformLocations_;

    /**
     * @private
     * @type {Object.<string, number>}
     */
    this.attribLocations_;

    /**
     * Holds info about custom uniforms used in the post processing pass.
     * If the uniform is a texture, the WebGL Texture object will be stored here.
     * @type {Array<UniformInternalDescription>}
     * @private
     */
    this.uniforms_ = [];
    options.uniforms && Object.keys(options.uniforms).forEach(function(name) {
      this.uniforms_.push({
        name: name,
        value: options.uniforms[name]
      });
    }.bind(this));

    /**
     * An array of PostProcessingPass objects is kept in this variable, built from the steps provided in the
     * options. If no post process was given, a default one is used (so as not to have to make an exception to
     * the frame buffer logic).
     * @type {Array<WebGLPostProcessingPass>}
     * @private
     */
    this.postProcessPasses_ = options.postProcesses ? options.postProcesses.map(function(options) {
      return new WebGLPostProcessingPass({
        webGlContext: gl,
        scaleRatio: options.scaleRatio,
        vertexShader: options.vertexShader,
        fragmentShader: options.fragmentShader,
        uniforms: options.uniforms
      });
    }) : [new WebGLPostProcessingPass({webGlContext: gl})];
  }

  if ( Disposable ) WebGLHelper.__proto__ = Disposable;
  WebGLHelper.prototype = Object.create( Disposable && Disposable.prototype );
  WebGLHelper.prototype.constructor = WebGLHelper;

  /**
   * Just bind the buffer if it's in the cache. Otherwise create
   * the WebGL buffer, bind it, populate it, and add an entry to
   * the cache.
   * TODO: improve this, the logic is unclear: we want A/ to bind a buffer and B/ to flush data in it
   * @param {number} target Target.
   * @param {import("./Buffer").default} buf Buffer.
   * @api
   */
  WebGLHelper.prototype.bindBuffer = function bindBuffer (target, buf) {
    var gl = this.getGL();
    var arr = buf.getArray();
    var bufferKey = getUid(buf);
    var bufferCache = this.bufferCache_[bufferKey];
    if (!bufferCache) {
      var buffer = gl.createBuffer();
      bufferCache = this.bufferCache_[bufferKey] = {
        buf: buf,
        buffer: buffer
      };
    }
    gl.bindBuffer(target, bufferCache.buffer);
    var /** @type {ArrayBufferView} */ arrayBuffer;
    if (target == ARRAY_BUFFER) {
      arrayBuffer = new Float32Array(arr);
    } else if (target == ELEMENT_ARRAY_BUFFER) {
      arrayBuffer = this.hasOESElementIndexUint ?
        new Uint32Array(arr) : new Uint16Array(arr);
    }
    gl.bufferData(target, arrayBuffer, buf.getUsage());
  };

  /**
   * @param {import("./Buffer.js").default} buf Buffer.
   */
  WebGLHelper.prototype.deleteBuffer = function deleteBuffer (buf) {
    var gl = this.getGL();
    var bufferKey = getUid(buf);
    var bufferCacheEntry = this.bufferCache_[bufferKey];
    if (!gl.isContextLost()) {
      gl.deleteBuffer(bufferCacheEntry.buffer);
    }
    delete this.bufferCache_[bufferKey];
  };

  /**
   * @inheritDoc
   */
  WebGLHelper.prototype.disposeInternal = function disposeInternal () {
    unlistenAll(this.canvas_);
    var gl = this.getGL();
    if (!gl.isContextLost()) {
      for (var key in this.bufferCache_) {
        gl.deleteBuffer(this.bufferCache_[key].buffer);
      }
      for (var key$1 in this.programCache_) {
        gl.deleteProgram(this.programCache_[key$1]);
      }
      for (var key$2 in this.shaderCache_) {
        gl.deleteShader(this.shaderCache_[key$2]);
      }
    }
  };

  /**
   * Clear the buffer & set the viewport to draw.
   * Post process passes will be initialized here, the first one being bound as a render target for
   * subsequent draw calls.
   * @param {import("../PluggableMap.js").FrameState} frameState current frame state
   * @api
   */
  WebGLHelper.prototype.prepareDraw = function prepareDraw (frameState) {
    var gl = this.getGL();
    var canvas = this.getCanvas();
    var size = frameState.size;
    var pixelRatio = frameState.pixelRatio;

    canvas.width = size[0] * pixelRatio;
    canvas.height = size[1] * pixelRatio;
    canvas.style.width = size[0] + 'px';
    canvas.style.height = size[1] + 'px';

    gl.useProgram(this.currentProgram_);

    // loop backwards in post processes list
    for (var i = this.postProcessPasses_.length - 1; i >= 0; i--) {
      this.postProcessPasses_[i].init(frameState);
    }

    gl.bindTexture(gl.TEXTURE_2D, null);

    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    this.applyFrameState(frameState);
    this.applyUniforms(frameState);
  };

  /**
   * Execute a draw call based on the currently bound program, texture, buffers, attributes.
   * @param {number} start Start index.
   * @param {number} end End index.
   * @api
   */
  WebGLHelper.prototype.drawElements = function drawElements (start, end) {
    var gl = this.getGL();
    var elementType = this.hasOESElementIndexUint ?
      gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    var elementSize = this.hasOESElementIndexUint ? 4 : 2;

    var numItems = end - start;
    var offsetInBytes = start * elementSize;
    gl.drawElements(gl.TRIANGLES, numItems, elementType, offsetInBytes);
  };

  /**
   * Apply the successive post process passes which will eventually render to the actual canvas.
   * @param {import("../PluggableMap.js").FrameState} frameState current frame state
   * @api
   */
  WebGLHelper.prototype.finalizeDraw = function finalizeDraw (frameState) {
    // apply post processes using the next one as target
    for (var i = 0; i < this.postProcessPasses_.length; i++) {
      this.postProcessPasses_[i].apply(frameState, this.postProcessPasses_[i + 1] || null);
    }
  };

  /**
   * @return {HTMLCanvasElement} Canvas.
   * @api
   */
  WebGLHelper.prototype.getCanvas = function getCanvas () {
    return this.canvas_;
  };

  /**
   * Get the WebGL rendering context
   * @return {WebGLRenderingContext} The rendering context.
   * @api
   */
  WebGLHelper.prototype.getGL = function getGL () {
    return this.gl_;
  };

  /**
   * Sets the default matrix uniforms for a given frame state. This is called internally in `prepareDraw`.
   * @param {import("../PluggableMap.js").FrameState} frameState Frame state.
   * @private
   */
  WebGLHelper.prototype.applyFrameState = function applyFrameState (frameState) {
    var size = frameState.size;
    var rotation = frameState.viewState.rotation;
    var resolution = frameState.viewState.resolution;
    var center = frameState.viewState.center;

    // set the "uniform" values (coordinates 0,0 are the center of the view)
    var projectionMatrix = resetTransform(this.projectionMatrix_);
    scaleTransform(projectionMatrix, 2 / (resolution * size[0]), 2 / (resolution * size[1]));
    rotateTransform(projectionMatrix, -rotation);
    translateTransform(projectionMatrix, -center[0], -center[1]);

    var offsetScaleMatrix = resetTransform(this.offsetScaleMatrix_);
    scaleTransform(offsetScaleMatrix, 2 / size[0], 2 / size[1]);

    var offsetRotateMatrix = resetTransform(this.offsetRotateMatrix_);
    if (rotation !== 0) {
      rotateTransform(offsetRotateMatrix, -rotation);
    }

    this.setUniformMatrixValue(DefaultUniform.PROJECTION_MATRIX, fromTransform(this.tmpMat4_, projectionMatrix));
    this.setUniformMatrixValue(DefaultUniform.OFFSET_SCALE_MATRIX, fromTransform(this.tmpMat4_, offsetScaleMatrix));
    this.setUniformMatrixValue(DefaultUniform.OFFSET_ROTATION_MATRIX, fromTransform(this.tmpMat4_, offsetRotateMatrix));
  };

  /**
   * Sets the custom uniforms based on what was given in the constructor. This is called internally in `prepareDraw`.
   * @param {import("../PluggableMap.js").FrameState} frameState Frame state.
   * @private
   */
  WebGLHelper.prototype.applyUniforms = function applyUniforms (frameState) {
    var gl = this.getGL();

    var value;
    var textureSlot = 0;
    this.uniforms_.forEach(function(uniform) {
      value = typeof uniform.value === 'function' ? uniform.value(frameState) : uniform.value;

      // apply value based on type
      if (value instanceof HTMLCanvasElement || value instanceof ImageData) {
        // create a texture & put data
        if (!uniform.texture) {
          uniform.texture = gl.createTexture();
        }
        gl.activeTexture(gl[("TEXTURE" + textureSlot)]);
        gl.bindTexture(gl.TEXTURE_2D, uniform.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        if (value instanceof ImageData) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, value.width, value.height, 0,
            gl.UNSIGNED_BYTE, new Uint8Array(value.data));
        } else {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, value);
        }

        // fill texture slots
        gl.uniform1i(this.getUniformLocation(uniform.name), textureSlot++);

      } else if (Array.isArray(value)) {
        switch (value.length) {
          case 2:
            gl.uniform2f(this.getUniformLocation(uniform.name), value[0], value[1]);
            return;
          case 3:
            gl.uniform3f(this.getUniformLocation(uniform.name), value[0], value[1], value[2]);
            return;
          case 4:
            gl.uniform4f(this.getUniformLocation(uniform.name), value[0], value[1], value[2], value[3]);
            return;
          default:
            return;
        }
      } else if (typeof value === 'number') {
        gl.uniform1f(this.getUniformLocation(uniform.name), value);
      }
    }.bind(this));
  };

  /**
   * Get shader from the cache if it's in the cache. Otherwise, create
   * the WebGL shader, compile it, and add entry to cache.
   * TODO: make compilation errors show up
   * @param {import("./Shader.js").default} shaderObject Shader object.
   * @return {WebGLShader} Shader.
   * @api
   */
  WebGLHelper.prototype.getShader = function getShader (shaderObject) {
    var shaderKey = getUid(shaderObject);
    if (shaderKey in this.shaderCache_) {
      return this.shaderCache_[shaderKey];
    } else {
      var gl = this.getGL();
      var shader = gl.createShader(shaderObject.getType());
      gl.shaderSource(shader, shaderObject.getSource());
      gl.compileShader(shader);
      this.shaderCache_[shaderKey] = shader;
      return shader;
    }
  };

  /**
   * Use a program.  If the program is already in use, this will return `false`.
   * @param {WebGLProgram} program Program.
   * @return {boolean} Changed.
   * @api
   */
  WebGLHelper.prototype.useProgram = function useProgram (program) {
    if (program == this.currentProgram_) {
      return false;
    } else {
      var gl = this.getGL();
      gl.useProgram(program);
      this.currentProgram_ = program;
      this.uniformLocations_ = {};
      this.attribLocations_ = {};
      return true;
    }
  };

  /**
   * Get the program from the cache if it's in the cache. Otherwise create
   * the WebGL program, attach the shaders to it, and add an entry to the
   * cache.
   * @param {import("./Fragment.js").default} fragmentShaderObject Fragment shader.
   * @param {import("./Vertex.js").default} vertexShaderObject Vertex shader.
   * @return {WebGLProgram} Program.
   * @api
   */
  WebGLHelper.prototype.getProgram = function getProgram (fragmentShaderObject, vertexShaderObject) {
    var programKey = getUid(fragmentShaderObject) + '/' + getUid(vertexShaderObject);
    if (programKey in this.programCache_) {
      return this.programCache_[programKey];
    } else {
      var gl = this.getGL();
      var program = gl.createProgram();
      gl.attachShader(program, this.getShader(fragmentShaderObject));
      gl.attachShader(program, this.getShader(vertexShaderObject));
      gl.linkProgram(program);
      this.programCache_[programKey] = program;
      return program;
    }
  };

  /**
   * Will get the location from the shader or the cache
   * @param {string} name Uniform name
   * @return {WebGLUniformLocation} uniformLocation
   * @api
   */
  WebGLHelper.prototype.getUniformLocation = function getUniformLocation (name) {
    if (!this.uniformLocations_[name]) {
      this.uniformLocations_[name] = this.getGL().getUniformLocation(this.currentProgram_, name);
    }
    return this.uniformLocations_[name];
  };

  /**
   * Will get the location from the shader or the cache
   * @param {string} name Attribute name
   * @return {number} attribLocation
   * @api
   */
  WebGLHelper.prototype.getAttributeLocation = function getAttributeLocation (name) {
    if (!this.attribLocations_[name]) {
      this.attribLocations_[name] = this.getGL().getAttribLocation(this.currentProgram_, name);
    }
    return this.attribLocations_[name];
  };

  /**
   * Give a value for a standard float uniform
   * @param {string} uniform Uniform name
   * @param {number} value Value
   * @api
   */
  WebGLHelper.prototype.setUniformFloatValue = function setUniformFloatValue (uniform, value) {
    this.getGL().uniform1f(this.getUniformLocation(uniform), value);
  };

  /**
   * Give a value for a standard matrix4 uniform
   * @param {string} uniform Uniform name
   * @param {Array<number>} value Matrix value
   * @api
   */
  WebGLHelper.prototype.setUniformMatrixValue = function setUniformMatrixValue (uniform, value) {
    this.getGL().uniformMatrix4fv(this.getUniformLocation(uniform), false, value);
  };

  /**
   * Will set the currently bound buffer to an attribute of the shader program
   * @param {string} attribName Attribute name
   * @param {number} size Number of components per attributes
   * @param {number} type UNSIGNED_INT, UNSIGNED_BYTE, UNSIGNED_SHORT or FLOAT
   * @param {number} stride Stride in bytes (0 means attribs are packed)
   * @param {number} offset Offset in bytes
   * @api
   */
  WebGLHelper.prototype.enableAttributeArray = function enableAttributeArray (attribName, size, type, stride, offset) {
    this.getGL().enableVertexAttribArray(this.getAttributeLocation(attribName));
    this.getGL().vertexAttribPointer(this.getAttributeLocation(attribName), size, type,
      false, stride, offset);
  };

  /**
   * WebGL context was lost
   * @private
   */
  WebGLHelper.prototype.handleWebGLContextLost = function handleWebGLContextLost () {
    clear(this.bufferCache_);
    clear(this.shaderCache_);
    clear(this.programCache_);
    this.currentProgram_ = null;
  };

  /**
   * WebGL context was restored
   * @private
   */
  WebGLHelper.prototype.handleWebGLContextRestored = function handleWebGLContextRestored () {
  };

  // TODO: shutdown program

  /**
   * TODO: these are not used and should be reworked
   * @param {number=} opt_wrapS wrapS.
   * @param {number=} opt_wrapT wrapT.
   * @return {WebGLTexture} The texture.
   */
  WebGLHelper.prototype.createTextureInternal = function createTextureInternal (opt_wrapS, opt_wrapT) {
    var gl = this.getGL();
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

    if (opt_wrapS !== undefined) {
      gl.texParameteri(
        TEXTURE_2D, TEXTURE_WRAP_S, opt_wrapS);
    }
    if (opt_wrapT !== undefined) {
      gl.texParameteri(
        TEXTURE_2D, TEXTURE_WRAP_T, opt_wrapT);
    }

    return texture;
  };

  /**
   * TODO: these are not used and should be reworked
   * @param {number} width Width.
   * @param {number} height Height.
   * @param {number=} opt_wrapS wrapS.
   * @param {number=} opt_wrapT wrapT.
   * @return {WebGLTexture} The texture.
   */
  WebGLHelper.prototype.createEmptyTexture = function createEmptyTexture (width, height, opt_wrapS, opt_wrapT) {
    var gl = this.getGL();
    var texture = this.createTextureInternal(opt_wrapS, opt_wrapT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return texture;
  };


  /**
   * TODO: these are not used and should be reworked
   * @param {HTMLCanvasElement|HTMLImageElement|HTMLVideoElement} image Image.
   * @param {number=} opt_wrapS wrapS.
   * @param {number=} opt_wrapT wrapT.
   * @return {WebGLTexture} The texture.
   */
  WebGLHelper.prototype.createTexture = function createTexture (image, opt_wrapS, opt_wrapT) {
    var gl = this.getGL();
    var texture = this.createTextureInternal(opt_wrapS, opt_wrapT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    return texture;
  };

  return WebGLHelper;
}(Disposable));

export default WebGLHelper;

//# sourceMappingURL=Helper.js.map