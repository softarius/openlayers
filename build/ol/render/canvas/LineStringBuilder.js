/**
 * @module ol/render/canvas/LineStringBuilder
 */
import CanvasInstruction, {strokeInstruction, beginPathInstruction} from './Instruction.js';
import CanvasBuilder from './Builder.js';

var CanvasLineStringBuilder = /*@__PURE__*/(function (CanvasBuilder) {
  function CanvasLineStringBuilder(tolerance, maxExtent, resolution, pixelRatio, overlaps, declutterTree) {
    CanvasBuilder.call(this, tolerance, maxExtent, resolution, pixelRatio, overlaps, declutterTree);
  }

  if ( CanvasBuilder ) CanvasLineStringBuilder.__proto__ = CanvasBuilder;
  CanvasLineStringBuilder.prototype = Object.create( CanvasBuilder && CanvasBuilder.prototype );
  CanvasLineStringBuilder.prototype.constructor = CanvasLineStringBuilder;

  /**
   * @param {Array<number>} flatCoordinates Flat coordinates.
   * @param {number} offset Offset.
   * @param {number} end End.
   * @param {number} stride Stride.
   * @private
   * @return {number} end.
   */
  CanvasLineStringBuilder.prototype.drawFlatCoordinates_ = function drawFlatCoordinates_ (flatCoordinates, offset, end, stride) {
    var myBegin = this.coordinates.length;
    var myEnd = this.appendFlatCoordinates(
      flatCoordinates, offset, end, stride, false, false);
    var moveToLineToInstruction = [CanvasInstruction.MOVE_TO_LINE_TO, myBegin, myEnd];
    this.instructions.push(moveToLineToInstruction);
    this.hitDetectionInstructions.push(moveToLineToInstruction);
    return end;
  };

  /**
   * @inheritDoc
   */
  CanvasLineStringBuilder.prototype.drawLineString = function drawLineString (lineStringGeometry, feature) {
    var state = this.state;
    var strokeStyle = state.strokeStyle;
    var lineWidth = state.lineWidth;
    if (strokeStyle === undefined || lineWidth === undefined) {
      return;
    }
    this.updateStrokeStyle(state, this.applyStroke);
    this.beginGeometry(lineStringGeometry, feature);
    this.hitDetectionInstructions.push([
      CanvasInstruction.SET_STROKE_STYLE,
      state.strokeStyle, state.lineWidth, state.lineCap, state.lineJoin,
      state.miterLimit, state.lineDash, state.lineDashOffset
    ], beginPathInstruction);
    var flatCoordinates = lineStringGeometry.getFlatCoordinates();
    var stride = lineStringGeometry.getStride();
    this.drawFlatCoordinates_(flatCoordinates, 0, flatCoordinates.length, stride);
    this.hitDetectionInstructions.push(strokeInstruction);
    this.endGeometry(lineStringGeometry, feature);
  };

  /**
   * @inheritDoc
   */
  CanvasLineStringBuilder.prototype.drawMultiLineString = function drawMultiLineString (multiLineStringGeometry, feature) {
    var state = this.state;
    var strokeStyle = state.strokeStyle;
    var lineWidth = state.lineWidth;
    if (strokeStyle === undefined || lineWidth === undefined) {
      return;
    }
    this.updateStrokeStyle(state, this.applyStroke);
    this.beginGeometry(multiLineStringGeometry, feature);
    this.hitDetectionInstructions.push([
      CanvasInstruction.SET_STROKE_STYLE,
      state.strokeStyle, state.lineWidth, state.lineCap, state.lineJoin,
      state.miterLimit, state.lineDash, state.lineDashOffset
    ], beginPathInstruction);
    var ends = multiLineStringGeometry.getEnds();
    var flatCoordinates = multiLineStringGeometry.getFlatCoordinates();
    var stride = multiLineStringGeometry.getStride();
    var offset = 0;
    for (var i = 0, ii = ends.length; i < ii; ++i) {
      offset = this.drawFlatCoordinates_(flatCoordinates, offset, ends[i], stride);
    }
    this.hitDetectionInstructions.push(strokeInstruction);
    this.endGeometry(multiLineStringGeometry, feature);
  };

  /**
   * @inheritDoc
   */
  CanvasLineStringBuilder.prototype.finish = function finish () {
    var state = this.state;
    if (state.lastStroke != undefined && state.lastStroke != this.coordinates.length) {
      this.instructions.push(strokeInstruction);
    }
    this.reverseHitDetectionInstructions();
    this.state = null;
    return CanvasBuilder.prototype.finish.call(this);
  };

  /**
   * @inheritDoc.
   */
  CanvasLineStringBuilder.prototype.applyStroke = function applyStroke (state) {
    if (state.lastStroke != undefined && state.lastStroke != this.coordinates.length) {
      this.instructions.push(strokeInstruction);
      state.lastStroke = this.coordinates.length;
    }
    state.lastStroke = 0;
    CanvasBuilder.prototype.applyStroke.call(this, state);
    this.instructions.push(beginPathInstruction);
  };

  return CanvasLineStringBuilder;
}(CanvasBuilder));


export default CanvasLineStringBuilder;

//# sourceMappingURL=LineStringBuilder.js.map