/**
 * @module ol/render/canvas/TextBuilder
 */
import {getUid} from '../../util.js';
import {asColorLike} from '../../colorlike.js';
import {intersects} from '../../extent.js';
import {matchingChunk} from '../../geom/flat/straightchunk.js';
import GeometryType from '../../geom/GeometryType.js';
import {labelCache, defaultTextAlign, defaultPadding, defaultLineCap, defaultLineDashOffset, defaultLineDash, defaultLineJoin, defaultFillStyle, checkFont, defaultFont, defaultLineWidth, defaultMiterLimit, defaultStrokeStyle, defaultTextBaseline} from '../canvas.js';
import CanvasInstruction from './Instruction.js';
import CanvasBuilder from './Builder.js';
import {TEXT_ALIGN} from '../replay.js';
import TextPlacement from '../../style/TextPlacement.js';

var CanvasTextBuilder = /*@__PURE__*/(function (CanvasBuilder) {
  function CanvasTextBuilder(tolerance, maxExtent, resolution, pixelRatio, overlaps, declutterTree) {
    CanvasBuilder.call(this, tolerance, maxExtent, resolution, pixelRatio, overlaps, declutterTree);

    /**
     * @private
     * @type {import("../canvas.js").DeclutterGroup}
     */
    this.declutterGroup_;

    /**
     * @private
     * @type {Array<HTMLCanvasElement>}
     */
    this.labels_ = null;

    /**
     * @private
     * @type {string}
     */
    this.text_ = '';

    /**
     * @private
     * @type {number}
     */
    this.textOffsetX_ = 0;

    /**
     * @private
     * @type {number}
     */
    this.textOffsetY_ = 0;

    /**
     * @private
     * @type {boolean|undefined}
     */
    this.textRotateWithView_ = undefined;

    /**
     * @private
     * @type {number}
     */
    this.textRotation_ = 0;

    /**
     * @private
     * @type {?import("../canvas.js").FillState}
     */
    this.textFillState_ = null;

    /**
     * @type {!Object<string, import("../canvas.js").FillState>}
     */
    this.fillStates = {};

    /**
     * @private
     * @type {?import("../canvas.js").StrokeState}
     */
    this.textStrokeState_ = null;

    /**
     * @type {!Object<string, import("../canvas.js").StrokeState>}
     */
    this.strokeStates = {};

    /**
     * @private
     * @type {import("../canvas.js").TextState}
     */
    this.textState_ = /** @type {import("../canvas.js").TextState} */ ({});

    /**
     * @type {!Object<string, import("../canvas.js").TextState>}
     */
    this.textStates = {};

    /**
     * @private
     * @type {string}
     */
    this.textKey_ = '';

    /**
     * @private
     * @type {string}
     */
    this.fillKey_ = '';

    /**
     * @private
     * @type {string}
     */
    this.strokeKey_ = '';

    labelCache.prune();
  }

  if ( CanvasBuilder ) CanvasTextBuilder.__proto__ = CanvasBuilder;
  CanvasTextBuilder.prototype = Object.create( CanvasBuilder && CanvasBuilder.prototype );
  CanvasTextBuilder.prototype.constructor = CanvasTextBuilder;

  /**
   * @inheritdoc
   */
  CanvasTextBuilder.prototype.finish = function finish () {
    var instructions = CanvasBuilder.prototype.finish.call(this);
    instructions.textStates = this.textStates;
    instructions.fillStates = this.fillStates;
    instructions.strokeStates = this.strokeStates;
    return instructions;
  };

  /**
   * @inheritDoc
   */
  CanvasTextBuilder.prototype.drawText = function drawText (geometry, feature) {
    var fillState = this.textFillState_;
    var strokeState = this.textStrokeState_;
    var textState = this.textState_;
    if (this.text_ === '' || !textState || (!fillState && !strokeState)) {
      return;
    }

    var begin = this.coordinates.length;

    var geometryType = geometry.getType();
    var flatCoordinates = null;
    var end = 2;
    var stride = 2;
    var i, ii;

    if (textState.placement === TextPlacement.LINE) {
      if (!intersects(this.getBufferedMaxExtent(), geometry.getExtent())) {
        return;
      }
      var ends;
      flatCoordinates = geometry.getFlatCoordinates();
      stride = geometry.getStride();
      if (geometryType == GeometryType.LINE_STRING) {
        ends = [flatCoordinates.length];
      } else if (geometryType == GeometryType.MULTI_LINE_STRING) {
        ends = geometry.getEnds();
      } else if (geometryType == GeometryType.POLYGON) {
        ends = geometry.getEnds().slice(0, 1);
      } else if (geometryType == GeometryType.MULTI_POLYGON) {
        var endss = geometry.getEndss();
        ends = [];
        for (i = 0, ii = endss.length; i < ii; ++i) {
          ends.push(endss[i][0]);
        }
      }
      this.beginGeometry(geometry, feature);
      var textAlign = textState.textAlign;
      var flatOffset = 0;
      var flatEnd;
      for (var o = 0, oo = ends.length; o < oo; ++o) {
        if (textAlign == undefined) {
          var range = matchingChunk(textState.maxAngle, flatCoordinates, flatOffset, ends[o], stride);
          flatOffset = range[0];
          flatEnd = range[1];
        } else {
          flatEnd = ends[o];
        }
        for (i = flatOffset; i < flatEnd; i += stride) {
          this.coordinates.push(flatCoordinates[i], flatCoordinates[i + 1]);
        }
        end = this.coordinates.length;
        flatOffset = ends[o];
        this.drawChars_(begin, end, this.declutterGroup_);
        begin = end;
      }
      this.endGeometry(geometry, feature);

    } else {

      var geometryWidths = null;
      if (!textState.overflow) {
        geometryWidths = [];
      }
      switch (geometryType) {
        case GeometryType.POINT:
        case GeometryType.MULTI_POINT:
          flatCoordinates = geometry.getFlatCoordinates();
          end = flatCoordinates.length;
          break;
        case GeometryType.LINE_STRING:
          flatCoordinates = /** @type {import("../../geom/LineString.js").default} */ (geometry).getFlatMidpoint();
          break;
        case GeometryType.CIRCLE:
          flatCoordinates = /** @type {import("../../geom/Circle.js").default} */ (geometry).getCenter();
          break;
        case GeometryType.MULTI_LINE_STRING:
          flatCoordinates = /** @type {import("../../geom/MultiLineString.js").default} */ (geometry).getFlatMidpoints();
          end = flatCoordinates.length;
          break;
        case GeometryType.POLYGON:
          flatCoordinates = /** @type {import("../../geom/Polygon.js").default} */ (geometry).getFlatInteriorPoint();
          if (!textState.overflow) {
            geometryWidths.push(flatCoordinates[2] / this.resolution);
          }
          stride = 3;
          break;
        case GeometryType.MULTI_POLYGON:
          var interiorPoints = /** @type {import("../../geom/MultiPolygon.js").default} */ (geometry).getFlatInteriorPoints();
          flatCoordinates = [];
          for (i = 0, ii = interiorPoints.length; i < ii; i += 3) {
            if (!textState.overflow) {
              geometryWidths.push(interiorPoints[i + 2] / this.resolution);
            }
            flatCoordinates.push(interiorPoints[i], interiorPoints[i + 1]);
          }
          end = flatCoordinates.length;
          if (end == 0) {
            return;
          }
          break;
        default:
      }
      end = this.appendFlatCoordinates(flatCoordinates, 0, end, stride, false, false);

      this.saveTextStates_();

      if (textState.backgroundFill || textState.backgroundStroke) {
        this.setFillStrokeStyle(textState.backgroundFill, textState.backgroundStroke);
        if (textState.backgroundFill) {
          this.updateFillStyle(this.state, this.createFill, geometry);
          this.hitDetectionInstructions.push(this.createFill(this.state, geometry));
        }
        if (textState.backgroundStroke) {
          this.updateStrokeStyle(this.state, this.applyStroke);
          this.hitDetectionInstructions.push(this.createStroke(this.state));
        }
      }

      this.beginGeometry(geometry, feature);

      // The image is unknown at this stage so we pass null; it will be computed at render time.
      // For clarity, we pass NaN for offsetX, offsetY, width and height, which will be computed at
      // render time.
      var pixelRatio = this.pixelRatio;
      this.instructions.push([CanvasInstruction.DRAW_IMAGE, begin, end,
        null, NaN, NaN, this.declutterGroup_, NaN, 1, 0, 0,
        this.textRotateWithView_, this.textRotation_, 1, NaN,
        textState.padding == defaultPadding ?
          defaultPadding : textState.padding.map(function(p) {
            return p * pixelRatio;
          }),
        !!textState.backgroundFill, !!textState.backgroundStroke,
        this.text_, this.textKey_, this.strokeKey_, this.fillKey_,
        this.textOffsetX_, this.textOffsetY_, geometryWidths
      ]);
      this.hitDetectionInstructions.push([CanvasInstruction.DRAW_IMAGE, begin, end,
        null, NaN, NaN, this.declutterGroup_, NaN, 1, 0, 0,
        this.textRotateWithView_, this.textRotation_, 1 / this.pixelRatio, NaN,
        textState.padding,
        !!textState.backgroundFill, !!textState.backgroundStroke,
        this.text_, this.textKey_, this.strokeKey_, this.fillKey_,
        this.textOffsetX_, this.textOffsetY_, geometryWidths
      ]);

      this.endGeometry(geometry, feature);
    }
  };

  /**
   * @private
   */
  CanvasTextBuilder.prototype.saveTextStates_ = function saveTextStates_ () {
    var strokeState = this.textStrokeState_;
    var textState = this.textState_;
    var fillState = this.textFillState_;

    var strokeKey = this.strokeKey_;
    if (strokeState) {
      if (!(strokeKey in this.strokeStates)) {
        this.strokeStates[strokeKey] = /** @type {import("../canvas.js").StrokeState} */ ({
          strokeStyle: strokeState.strokeStyle,
          lineCap: strokeState.lineCap,
          lineDashOffset: strokeState.lineDashOffset,
          lineWidth: strokeState.lineWidth,
          lineJoin: strokeState.lineJoin,
          miterLimit: strokeState.miterLimit,
          lineDash: strokeState.lineDash
        });
      }
    }
    var textKey = this.textKey_;
    if (!(textKey in this.textStates)) {
      this.textStates[textKey] = /** @type {import("../canvas.js").TextState} */ ({
        font: textState.font,
        textAlign: textState.textAlign || defaultTextAlign,
        textBaseline: textState.textBaseline || defaultTextBaseline,
        scale: textState.scale
      });
    }
    var fillKey = this.fillKey_;
    if (fillState) {
      if (!(fillKey in this.fillStates)) {
        this.fillStates[fillKey] = /** @type {import("../canvas.js").FillState} */ ({
          fillStyle: fillState.fillStyle
        });
      }
    }
  };

  /**
   * @private
   * @param {number} begin Begin.
   * @param {number} end End.
   * @param {import("../canvas.js").DeclutterGroup} declutterGroup Declutter group.
   */
  CanvasTextBuilder.prototype.drawChars_ = function drawChars_ (begin, end, declutterGroup) {
    var strokeState = this.textStrokeState_;
    var textState = this.textState_;

    var strokeKey = this.strokeKey_;
    var textKey = this.textKey_;
    var fillKey = this.fillKey_;
    this.saveTextStates_();


    var pixelRatio = this.pixelRatio;
    var baseline = TEXT_ALIGN[textState.textBaseline];

    var offsetY = this.textOffsetY_ * pixelRatio;
    var text = this.text_;
    var textScale = textState.scale;
    var strokeWidth = strokeState ? strokeState.lineWidth * textScale / 2 : 0;

    this.instructions.push([CanvasInstruction.DRAW_CHARS,
      begin, end, baseline, declutterGroup,
      textState.overflow, fillKey, textState.maxAngle,
      pixelRatio,
      offsetY, strokeKey, strokeWidth * pixelRatio, text, textKey, 1
    ]);
    this.hitDetectionInstructions.push([CanvasInstruction.DRAW_CHARS,
      begin, end, baseline, declutterGroup,
      textState.overflow, fillKey, textState.maxAngle,
      1,
      offsetY, strokeKey, strokeWidth, text, textKey, 1 / pixelRatio
    ]);
  };

  /**
   * @inheritDoc
   */
  CanvasTextBuilder.prototype.setTextStyle = function setTextStyle (textStyle, declutterGroup) {
    var textState, fillState, strokeState;
    if (!textStyle) {
      this.text_ = '';
    } else {
      this.declutterGroup_ = /** @type {import("../canvas.js").DeclutterGroup} */ (declutterGroup);

      var textFillStyle = textStyle.getFill();
      if (!textFillStyle) {
        fillState = this.textFillState_ = null;
      } else {
        fillState = this.textFillState_;
        if (!fillState) {
          fillState = this.textFillState_ = /** @type {import("../canvas.js").FillState} */ ({});
        }
        fillState.fillStyle = asColorLike(
          textFillStyle.getColor() || defaultFillStyle);
      }

      var textStrokeStyle = textStyle.getStroke();
      if (!textStrokeStyle) {
        strokeState = this.textStrokeState_ = null;
      } else {
        strokeState = this.textStrokeState_;
        if (!strokeState) {
          strokeState = this.textStrokeState_ = /** @type {import("../canvas.js").StrokeState} */ ({});
        }
        var lineDash = textStrokeStyle.getLineDash();
        var lineDashOffset = textStrokeStyle.getLineDashOffset();
        var lineWidth = textStrokeStyle.getWidth();
        var miterLimit = textStrokeStyle.getMiterLimit();
        strokeState.lineCap = textStrokeStyle.getLineCap() || defaultLineCap;
        strokeState.lineDash = lineDash ? lineDash.slice() : defaultLineDash;
        strokeState.lineDashOffset =
            lineDashOffset === undefined ? defaultLineDashOffset : lineDashOffset;
        strokeState.lineJoin = textStrokeStyle.getLineJoin() || defaultLineJoin;
        strokeState.lineWidth =
            lineWidth === undefined ? defaultLineWidth : lineWidth;
        strokeState.miterLimit =
            miterLimit === undefined ? defaultMiterLimit : miterLimit;
        strokeState.strokeStyle = asColorLike(
          textStrokeStyle.getColor() || defaultStrokeStyle);
      }

      textState = this.textState_;
      var font = textStyle.getFont() || defaultFont;
      checkFont(font);
      var textScale = textStyle.getScale();
      textState.overflow = textStyle.getOverflow();
      textState.font = font;
      textState.maxAngle = textStyle.getMaxAngle();
      textState.placement = textStyle.getPlacement();
      textState.textAlign = textStyle.getTextAlign();
      textState.textBaseline = textStyle.getTextBaseline() || defaultTextBaseline;
      textState.backgroundFill = textStyle.getBackgroundFill();
      textState.backgroundStroke = textStyle.getBackgroundStroke();
      textState.padding = textStyle.getPadding() || defaultPadding;
      textState.scale = textScale === undefined ? 1 : textScale;

      var textOffsetX = textStyle.getOffsetX();
      var textOffsetY = textStyle.getOffsetY();
      var textRotateWithView = textStyle.getRotateWithView();
      var textRotation = textStyle.getRotation();
      this.text_ = textStyle.getText() || '';
      this.textOffsetX_ = textOffsetX === undefined ? 0 : textOffsetX;
      this.textOffsetY_ = textOffsetY === undefined ? 0 : textOffsetY;
      this.textRotateWithView_ = textRotateWithView === undefined ? false : textRotateWithView;
      this.textRotation_ = textRotation === undefined ? 0 : textRotation;

      this.strokeKey_ = strokeState ?
        (typeof strokeState.strokeStyle == 'string' ? strokeState.strokeStyle : getUid(strokeState.strokeStyle)) +
        strokeState.lineCap + strokeState.lineDashOffset + '|' + strokeState.lineWidth +
        strokeState.lineJoin + strokeState.miterLimit + '[' + strokeState.lineDash.join() + ']' :
        '';
      this.textKey_ = textState.font + textState.scale + (textState.textAlign || '?');
      this.fillKey_ = fillState ?
        (typeof fillState.fillStyle == 'string' ? fillState.fillStyle : ('|' + getUid(fillState.fillStyle))) :
        '';
    }
  };

  return CanvasTextBuilder;
}(CanvasBuilder));


export default CanvasTextBuilder;

//# sourceMappingURL=TextBuilder.js.map