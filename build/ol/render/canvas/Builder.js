/**
 * @module ol/render/canvas/Builder
 */
import {equals, reverseSubArray} from '../../array.js';
import {asColorLike} from '../../colorlike.js';
import {buffer, clone, coordinateRelationship} from '../../extent.js';
import Relationship from '../../extent/Relationship.js';
import GeometryType from '../../geom/GeometryType.js';
import {inflateCoordinates, inflateCoordinatesArray, inflateMultiCoordinatesArray} from '../../geom/flat/inflate.js';
import {CANVAS_LINE_DASH} from '../../has.js';
import VectorContext from '../VectorContext.js';
import {resetTransform, defaultFillStyle, defaultStrokeStyle,
  defaultMiterLimit, defaultLineWidth, defaultLineJoin, defaultLineDashOffset,
  defaultLineDash, defaultLineCap} from '../canvas.js';
import CanvasInstruction from './Instruction.js';
import {
  create as createTransform,
  apply as applyTransform
} from '../../transform.js';


/**
 * @typedef {Object} SerializableInstructions
 * @property {Array<*>} instructions The rendering instructions.
 * @property {Array<*>} hitDetectionInstructions The rendering hit detection instructions.
 * @property {Array<number>} coordinates The array of all coordinates.
 * @property {!Object<string, import("../canvas.js").TextState>} [textStates] The text states (decluttering).
 * @property {!Object<string, import("../canvas.js").FillState>} [fillStates] The fill states (decluttering).
 * @property {!Object<string, import("../canvas.js").StrokeState>} [strokeStates] The stroke states (decluttering).
 */


var CanvasBuilder = /*@__PURE__*/(function (VectorContext) {
  function CanvasBuilder(tolerance, maxExtent, resolution, pixelRatio, overlaps, declutterTree) {
    VectorContext.call(this);

    /**
     * @type {?}
     */
    this.declutterTree = declutterTree;

    /**
     * @protected
     * @type {number}
     */
    this.tolerance = tolerance;

    /**
     * @protected
     * @const
     * @type {import("../../extent.js").Extent}
     */
    this.maxExtent = maxExtent;

    /**
     * @protected
     * @type {boolean}
     */
    this.overlaps = overlaps;

    /**
     * @protected
     * @type {number}
     */
    this.pixelRatio = pixelRatio;

    /**
     * @protected
     * @type {number}
     */
    this.maxLineWidth = 0;

    /**
     * @protected
     * @const
     * @type {number}
     */
    this.resolution = resolution;

    /**
     * @private
     * @type {boolean}
     */
    this.alignFill_;

    /**
     * @private
     * @type {Array<*>}
     */
    this.beginGeometryInstruction1_ = null;

    /**
     * @private
     * @type {Array<*>}
     */
    this.beginGeometryInstruction2_ = null;

    /**
     * @private
     * @type {import("../../extent.js").Extent}
     */
    this.bufferedMaxExtent_ = null;

    /**
     * @protected
     * @type {Array<*>}
     */
    this.instructions = [];

    /**
     * @protected
     * @type {Array<number>}
     */
    this.coordinates = [];

    /**
     * @private
     * @type {!Object<number,import("../../coordinate.js").Coordinate|Array<import("../../coordinate.js").Coordinate>|Array<Array<import("../../coordinate.js").Coordinate>>>}
     */
    this.coordinateCache_ = {};

    /**
     * @private
     * @type {!import("../../transform.js").Transform}
     */
    this.renderedTransform_ = createTransform();

    /**
     * @protected
     * @type {Array<*>}
     */
    this.hitDetectionInstructions = [];

    /**
     * @private
     * @type {Array<number>}
     */
    this.pixelCoordinates_ = null;

    /**
     * @protected
     * @type {import("../canvas.js").FillStrokeState}
     */
    this.state = /** @type {import("../canvas.js").FillStrokeState} */ ({});

    /**
     * @private
     * @type {number}
     */
    this.viewRotation_ = 0;

  }

  if ( VectorContext ) CanvasBuilder.__proto__ = VectorContext;
  CanvasBuilder.prototype = Object.create( VectorContext && VectorContext.prototype );
  CanvasBuilder.prototype.constructor = CanvasBuilder;

  /**
   * @protected
   * @param {Array<number>} dashArray Dash array.
   * @return {Array<number>} Dash array with pixel ratio applied
   */
  CanvasBuilder.prototype.applyPixelRatio = function applyPixelRatio (dashArray) {
    var pixelRatio = this.pixelRatio;
    return pixelRatio == 1 ? dashArray : dashArray.map(function(dash) {
      return dash * pixelRatio;
    });
  };

  /**
   * @param {Array<number>} flatCoordinates Flat coordinates.
   * @param {number} offset Offset.
   * @param {number} end End.
   * @param {number} stride Stride.
   * @param {boolean} closed Last input coordinate equals first.
   * @param {boolean} skipFirst Skip first coordinate.
   * @protected
   * @return {number} My end.
   */
  CanvasBuilder.prototype.appendFlatCoordinates = function appendFlatCoordinates (flatCoordinates, offset, end, stride, closed, skipFirst) {

    var myEnd = this.coordinates.length;
    var extent = this.getBufferedMaxExtent();
    if (skipFirst) {
      offset += stride;
    }
    var lastCoord = [flatCoordinates[offset], flatCoordinates[offset + 1]];
    var nextCoord = [NaN, NaN];
    var skipped = true;

    var i, lastRel, nextRel;
    for (i = offset + stride; i < end; i += stride) {
      nextCoord[0] = flatCoordinates[i];
      nextCoord[1] = flatCoordinates[i + 1];
      nextRel = coordinateRelationship(extent, nextCoord);
      if (nextRel !== lastRel) {
        if (skipped) {
          this.coordinates[myEnd++] = lastCoord[0];
          this.coordinates[myEnd++] = lastCoord[1];
        }
        this.coordinates[myEnd++] = nextCoord[0];
        this.coordinates[myEnd++] = nextCoord[1];
        skipped = false;
      } else if (nextRel === Relationship.INTERSECTING) {
        this.coordinates[myEnd++] = nextCoord[0];
        this.coordinates[myEnd++] = nextCoord[1];
        skipped = false;
      } else {
        skipped = true;
      }
      lastCoord[0] = nextCoord[0];
      lastCoord[1] = nextCoord[1];
      lastRel = nextRel;
    }

    // Last coordinate equals first or only one point to append:
    if ((closed && skipped) || i === offset + stride) {
      this.coordinates[myEnd++] = lastCoord[0];
      this.coordinates[myEnd++] = lastCoord[1];
    }
    return myEnd;
  };

  /**
   * @param {Array<number>} flatCoordinates Flat coordinates.
   * @param {number} offset Offset.
   * @param {Array<number>} ends Ends.
   * @param {number} stride Stride.
   * @param {Array<number>} builderEnds Builder ends.
   * @return {number} Offset.
   */
  CanvasBuilder.prototype.drawCustomCoordinates_ = function drawCustomCoordinates_ (flatCoordinates, offset, ends, stride, builderEnds) {
    for (var i = 0, ii = ends.length; i < ii; ++i) {
      var end = ends[i];
      var builderEnd = this.appendFlatCoordinates(flatCoordinates, offset, end, stride, false, false);
      builderEnds.push(builderEnd);
      offset = end;
    }
    return offset;
  };

  /**
   * @inheritDoc.
   */
  CanvasBuilder.prototype.drawCustom = function drawCustom (geometry, feature, renderer) {
    this.beginGeometry(geometry, feature);
    var type = geometry.getType();
    var stride = geometry.getStride();
    var builderBegin = this.coordinates.length;
    var flatCoordinates, builderEnd, builderEnds, builderEndss;
    var offset;
    if (type == GeometryType.MULTI_POLYGON) {
      geometry = /** @type {import("../../geom/MultiPolygon.js").default} */ (geometry);
      flatCoordinates = geometry.getOrientedFlatCoordinates();
      builderEndss = [];
      var endss = geometry.getEndss();
      offset = 0;
      for (var i = 0, ii = endss.length; i < ii; ++i) {
        var myEnds = [];
        offset = this.drawCustomCoordinates_(flatCoordinates, offset, endss[i], stride, myEnds);
        builderEndss.push(myEnds);
      }
      this.instructions.push([CanvasInstruction.CUSTOM,
        builderBegin, builderEndss, geometry, renderer, inflateMultiCoordinatesArray]);
    } else if (type == GeometryType.POLYGON || type == GeometryType.MULTI_LINE_STRING) {
      builderEnds = [];
      flatCoordinates = (type == GeometryType.POLYGON) ?
        /** @type {import("../../geom/Polygon.js").default} */ (geometry).getOrientedFlatCoordinates() :
        geometry.getFlatCoordinates();
      offset = this.drawCustomCoordinates_(flatCoordinates, 0,
        /** @type {import("../../geom/Polygon.js").default|import("../../geom/MultiLineString.js").default} */ (geometry).getEnds(),
        stride, builderEnds);
      this.instructions.push([CanvasInstruction.CUSTOM,
        builderBegin, builderEnds, geometry, renderer, inflateCoordinatesArray]);
    } else if (type == GeometryType.LINE_STRING || type == GeometryType.MULTI_POINT) {
      flatCoordinates = geometry.getFlatCoordinates();
      builderEnd = this.appendFlatCoordinates(
        flatCoordinates, 0, flatCoordinates.length, stride, false, false);
      this.instructions.push([CanvasInstruction.CUSTOM,
        builderBegin, builderEnd, geometry, renderer, inflateCoordinates]);
    } else if (type == GeometryType.POINT) {
      flatCoordinates = geometry.getFlatCoordinates();
      this.coordinates.push(flatCoordinates[0], flatCoordinates[1]);
      builderEnd = this.coordinates.length;
      this.instructions.push([CanvasInstruction.CUSTOM,
        builderBegin, builderEnd, geometry, renderer]);
    }
    this.endGeometry(geometry, feature);
  };

  /**
   * @protected
   * @param {import("../../geom/Geometry.js").default|import("../Feature.js").default} geometry Geometry.
   * @param {import("../../Feature.js").default|import("../Feature.js").default} feature Feature.
   */
  CanvasBuilder.prototype.beginGeometry = function beginGeometry (geometry, feature) {
    this.beginGeometryInstruction1_ = [CanvasInstruction.BEGIN_GEOMETRY, feature, 0];
    this.instructions.push(this.beginGeometryInstruction1_);
    this.beginGeometryInstruction2_ = [CanvasInstruction.BEGIN_GEOMETRY, feature, 0];
    this.hitDetectionInstructions.push(this.beginGeometryInstruction2_);
  };

  /**
   * @return {SerializableInstructions} the serializable instructions.
   */
  CanvasBuilder.prototype.finish = function finish () {
    return {
      instructions: this.instructions,
      hitDetectionInstructions: this.hitDetectionInstructions,
      coordinates: this.coordinates
    };
  };

  /**
   * @private
   * @param {CanvasRenderingContext2D} context Context.
   */
  CanvasBuilder.prototype.fill_ = function fill_ (context) {
    if (this.alignFill_) {
      var origin = applyTransform(this.renderedTransform_, [0, 0]);
      var repeatSize = 512 * this.pixelRatio;
      context.translate(origin[0] % repeatSize, origin[1] % repeatSize);
      context.rotate(this.viewRotation_);
    }
    context.fill();
    if (this.alignFill_) {
      context.setTransform.apply(context, resetTransform);
    }
  };

  /**
   * @private
   * @param {CanvasRenderingContext2D} context Context.
   * @param {Array<*>} instruction Instruction.
   */
  CanvasBuilder.prototype.setStrokeStyle_ = function setStrokeStyle_ (context, instruction) {
    context.strokeStyle = /** @type {import("../../colorlike.js").ColorLike} */ (instruction[1]);
    context.lineWidth = /** @type {number} */ (instruction[2]);
    context.lineCap = /** @type {CanvasLineCap} */ (instruction[3]);
    context.lineJoin = /** @type {CanvasLineJoin} */ (instruction[4]);
    context.miterLimit = /** @type {number} */ (instruction[5]);
    if (CANVAS_LINE_DASH) {
      context.lineDashOffset = /** @type {number} */ (instruction[7]);
      context.setLineDash(/** @type {Array<number>} */ (instruction[6]));
    }
  };

  /**
   * Reverse the hit detection instructions.
   */
  CanvasBuilder.prototype.reverseHitDetectionInstructions = function reverseHitDetectionInstructions () {
    var hitDetectionInstructions = this.hitDetectionInstructions;
    // step 1 - reverse array
    hitDetectionInstructions.reverse();
    // step 2 - reverse instructions within geometry blocks
    var i;
    var n = hitDetectionInstructions.length;
    var instruction;
    var type;
    var begin = -1;
    for (i = 0; i < n; ++i) {
      instruction = hitDetectionInstructions[i];
      type = /** @type {CanvasInstruction} */ (instruction[0]);
      if (type == CanvasInstruction.END_GEOMETRY) {
        begin = i;
      } else if (type == CanvasInstruction.BEGIN_GEOMETRY) {
        instruction[2] = i;
        reverseSubArray(this.hitDetectionInstructions, begin, i);
        begin = -1;
      }
    }
  };

  /**
   * @inheritDoc
   */
  CanvasBuilder.prototype.setFillStrokeStyle = function setFillStrokeStyle (fillStyle, strokeStyle) {
    var state = this.state;
    if (fillStyle) {
      var fillStyleColor = fillStyle.getColor();
      state.fillStyle = asColorLike(fillStyleColor ?
        fillStyleColor : defaultFillStyle);
    } else {
      state.fillStyle = undefined;
    }
    if (strokeStyle) {
      var strokeStyleColor = strokeStyle.getColor();
      state.strokeStyle = asColorLike(strokeStyleColor ?
        strokeStyleColor : defaultStrokeStyle);
      var strokeStyleLineCap = strokeStyle.getLineCap();
      state.lineCap = strokeStyleLineCap !== undefined ?
        strokeStyleLineCap : defaultLineCap;
      var strokeStyleLineDash = strokeStyle.getLineDash();
      state.lineDash = strokeStyleLineDash ?
        strokeStyleLineDash.slice() : defaultLineDash;
      var strokeStyleLineDashOffset = strokeStyle.getLineDashOffset();
      state.lineDashOffset = strokeStyleLineDashOffset ?
        strokeStyleLineDashOffset : defaultLineDashOffset;
      var strokeStyleLineJoin = strokeStyle.getLineJoin();
      state.lineJoin = strokeStyleLineJoin !== undefined ?
        strokeStyleLineJoin : defaultLineJoin;
      var strokeStyleWidth = strokeStyle.getWidth();
      state.lineWidth = strokeStyleWidth !== undefined ?
        strokeStyleWidth : defaultLineWidth;
      var strokeStyleMiterLimit = strokeStyle.getMiterLimit();
      state.miterLimit = strokeStyleMiterLimit !== undefined ?
        strokeStyleMiterLimit : defaultMiterLimit;

      if (state.lineWidth > this.maxLineWidth) {
        this.maxLineWidth = state.lineWidth;
        // invalidate the buffered max extent cache
        this.bufferedMaxExtent_ = null;
      }
    } else {
      state.strokeStyle = undefined;
      state.lineCap = undefined;
      state.lineDash = null;
      state.lineDashOffset = undefined;
      state.lineJoin = undefined;
      state.lineWidth = undefined;
      state.miterLimit = undefined;
    }
  };

  /**
   * @param {import("../canvas.js").FillStrokeState} state State.
   * @param {import("../../geom/Geometry.js").default|import("../Feature.js").default} geometry Geometry.
   * @return {Array<*>} Fill instruction.
   */
  CanvasBuilder.prototype.createFill = function createFill (state, geometry) {
    var fillStyle = state.fillStyle;
    /** @type {Array<*>} */
    var fillInstruction = [CanvasInstruction.SET_FILL_STYLE, fillStyle];
    if (typeof fillStyle !== 'string') {
      // Fill is a pattern or gradient - align it!
      fillInstruction.push(true);
    }
    return fillInstruction;
  };

  /**
   * @param {import("../canvas.js").FillStrokeState} state State.
   */
  CanvasBuilder.prototype.applyStroke = function applyStroke (state) {
    this.instructions.push(this.createStroke(state));
  };

  /**
   * @param {import("../canvas.js").FillStrokeState} state State.
   * @return {Array<*>} Stroke instruction.
   */
  CanvasBuilder.prototype.createStroke = function createStroke (state) {
    return [
      CanvasInstruction.SET_STROKE_STYLE,
      state.strokeStyle, state.lineWidth * this.pixelRatio, state.lineCap,
      state.lineJoin, state.miterLimit,
      this.applyPixelRatio(state.lineDash), state.lineDashOffset * this.pixelRatio
    ];
  };

  /**
   * @param {import("../canvas.js").FillStrokeState} state State.
   * @param {function(this:CanvasBuilder, import("../canvas.js").FillStrokeState, (import("../../geom/Geometry.js").default|import("../Feature.js").default)):Array<*>} createFill Create fill.
   * @param {import("../../geom/Geometry.js").default|import("../Feature.js").default} geometry Geometry.
   */
  CanvasBuilder.prototype.updateFillStyle = function updateFillStyle (state, createFill, geometry) {
    var fillStyle = state.fillStyle;
    if (typeof fillStyle !== 'string' || state.currentFillStyle != fillStyle) {
      if (fillStyle !== undefined) {
        this.instructions.push(createFill.call(this, state, geometry));
      }
      state.currentFillStyle = fillStyle;
    }
  };

  /**
   * @param {import("../canvas.js").FillStrokeState} state State.
   * @param {function(this:CanvasBuilder, import("../canvas.js").FillStrokeState)} applyStroke Apply stroke.
   */
  CanvasBuilder.prototype.updateStrokeStyle = function updateStrokeStyle (state, applyStroke) {
    var strokeStyle = state.strokeStyle;
    var lineCap = state.lineCap;
    var lineDash = state.lineDash;
    var lineDashOffset = state.lineDashOffset;
    var lineJoin = state.lineJoin;
    var lineWidth = state.lineWidth;
    var miterLimit = state.miterLimit;
    if (state.currentStrokeStyle != strokeStyle ||
        state.currentLineCap != lineCap ||
        (lineDash != state.currentLineDash && !equals(state.currentLineDash, lineDash)) ||
        state.currentLineDashOffset != lineDashOffset ||
        state.currentLineJoin != lineJoin ||
        state.currentLineWidth != lineWidth ||
        state.currentMiterLimit != miterLimit) {
      if (strokeStyle !== undefined) {
        applyStroke.call(this, state);
      }
      state.currentStrokeStyle = strokeStyle;
      state.currentLineCap = lineCap;
      state.currentLineDash = lineDash;
      state.currentLineDashOffset = lineDashOffset;
      state.currentLineJoin = lineJoin;
      state.currentLineWidth = lineWidth;
      state.currentMiterLimit = miterLimit;
    }
  };

  /**
   * @param {import("../../geom/Geometry.js").default|import("../Feature.js").default} geometry Geometry.
   * @param {import("../../Feature.js").default|import("../Feature.js").default} feature Feature.
   */
  CanvasBuilder.prototype.endGeometry = function endGeometry (geometry, feature) {
    this.beginGeometryInstruction1_[2] = this.instructions.length;
    this.beginGeometryInstruction1_ = null;
    this.beginGeometryInstruction2_[2] = this.hitDetectionInstructions.length;
    this.beginGeometryInstruction2_ = null;
    var endGeometryInstruction = [CanvasInstruction.END_GEOMETRY, feature];
    this.instructions.push(endGeometryInstruction);
    this.hitDetectionInstructions.push(endGeometryInstruction);
  };

  /**
   * Get the buffered rendering extent.  Rendering will be clipped to the extent
   * provided to the constructor.  To account for symbolizers that may intersect
   * this extent, we calculate a buffered extent (e.g. based on stroke width).
   * @return {import("../../extent.js").Extent} The buffered rendering extent.
   * @protected
   */
  CanvasBuilder.prototype.getBufferedMaxExtent = function getBufferedMaxExtent () {
    if (!this.bufferedMaxExtent_) {
      this.bufferedMaxExtent_ = clone(this.maxExtent);
      if (this.maxLineWidth > 0) {
        var width = this.resolution * (this.maxLineWidth + 1) / 2;
        buffer(this.bufferedMaxExtent_, width, this.bufferedMaxExtent_);
      }
    }
    return this.bufferedMaxExtent_;
  };

  return CanvasBuilder;
}(VectorContext));


export default CanvasBuilder;

//# sourceMappingURL=Builder.js.map