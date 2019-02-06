/**
 * @module ol/render/canvas/Executor
 */
import {getUid} from '../../util.js';
import {equals, reverseSubArray} from '../../array.js';
import {buffer, clone, createEmpty, createOrUpdate,
  createOrUpdateEmpty, extend, extendCoordinate, intersects} from '../../extent.js';
import {lineStringLength} from '../../geom/flat/length.js';
import {drawTextOnPath} from '../../geom/flat/textpath.js';
import {transform2D} from '../../geom/flat/transform.js';
import {CANVAS_LINE_DASH} from '../../has.js';
import {isEmpty} from '../../obj.js';
import {drawImage, resetTransform, defaultPadding, defaultTextBaseline} from '../canvas.js';
import CanvasInstruction from './Instruction.js';
import {TEXT_ALIGN} from '../replay.js';
import {
  create as createTransform,
  compose as composeTransform,
  apply as applyTransform,
  setFromArray as transformSetFromArray
} from '../../transform.js';
import {createCanvasContext2D} from '../../dom.js';
import {labelCache, defaultTextAlign, measureTextHeight, measureAndCacheTextWidth, measureTextWidths} from '../canvas.js';


/**
 * @typedef {Object} SerializableInstructions
 * @property {Array<*>} instructions The rendering instructions.
 * @property {Array<*>} hitDetectionInstructions The rendering hit detection instructions.
 * @property {Array<number>} coordinates The array of all coordinates.
 * @property {!Object<string, import("../canvas.js").TextState>} textStates The text states (decluttering).
 * @property {!Object<string, import("../canvas.js").FillState>} fillStates The fill states (decluttering).
 * @property {!Object<string, import("../canvas.js").StrokeState>} strokeStates The stroke states (decluttering).
 */

/**
 * @type {import("../../extent.js").Extent}
 */
var tmpExtent = createEmpty();


/**
 * @type {!import("../../transform.js").Transform}
 */
var tmpTransform = createTransform();


var CanvasExecutor = function CanvasExecutor(tolerance, maxExtent, resolution, pixelRatio, overlaps, declutterTree, instructions) {
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
  this.instructions = instructions.instructions;

  /**
   * @protected
   * @type {Array<number>}
   */
  this.coordinates = instructions.coordinates;

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
  this.hitDetectionInstructions = instructions.hitDetectionInstructions;

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

  /**
   * @type {!Object<string, import("../canvas.js").FillState>}
   */
  this.fillStates = instructions.fillStates || {};

  /**
   * @type {!Object<string, import("../canvas.js").StrokeState>}
   */
  this.strokeStates = instructions.strokeStates || {};

  /**
   * @type {!Object<string, import("../canvas.js").TextState>}
   */
  this.textStates = instructions.textStates || {};

  // Adaptations

  /**
   * @private
   * @type {Object<string, Object<string, number>>}
   */
  this.widths_ = {};
};


/**
 * @param {string} text Text.
 * @param {string} textKey Text style key.
 * @param {string} fillKey Fill style key.
 * @param {string} strokeKey Stroke style key.
 * @return {HTMLCanvasElement} Image.
 */
CanvasExecutor.prototype.getTextImage = function getTextImage (text, textKey, fillKey, strokeKey) {
  var label;
  var key = strokeKey + textKey + text + fillKey + this.pixelRatio;

  if (!labelCache.containsKey(key)) {
    var strokeState = strokeKey ? this.strokeStates[strokeKey] : null;
    var fillState = fillKey ? this.fillStates[fillKey] : null;
    var textState = this.textStates[textKey];
    var pixelRatio = this.pixelRatio;
    var scale = textState.scale * pixelRatio;
    var align = TEXT_ALIGN[textState.textAlign || defaultTextAlign];
    var strokeWidth = strokeKey && strokeState.lineWidth ? strokeState.lineWidth : 0;

    var lines = text.split('\n');
    var numLines = lines.length;
    var widths = [];
    var width = measureTextWidths(textState.font, lines, widths);
    var lineHeight = measureTextHeight(textState.font);
    var height = lineHeight * numLines;
    var renderWidth = (width + strokeWidth);
    var context = createCanvasContext2D(
      Math.ceil(renderWidth * scale),
      Math.ceil((height + strokeWidth) * scale));
    label = context.canvas;
    labelCache.set(key, label);
    if (scale != 1) {
      context.scale(scale, scale);
    }
    context.font = textState.font;
    if (strokeKey) {
      context.strokeStyle = strokeState.strokeStyle;
      context.lineWidth = strokeWidth;
      context.lineCap = /** @type {CanvasLineCap} */ (strokeState.lineCap);
      context.lineJoin = /** @type {CanvasLineJoin} */ (strokeState.lineJoin);
      context.miterLimit = strokeState.miterLimit;
      if (CANVAS_LINE_DASH && strokeState.lineDash.length) {
        context.setLineDash(strokeState.lineDash);
        context.lineDashOffset = strokeState.lineDashOffset;
      }
    }
    if (fillKey) {
      context.fillStyle = fillState.fillStyle;
    }
    context.textBaseline = 'middle';
    context.textAlign = 'center';
    var leftRight = (0.5 - align);
    var x = align * label.width / scale + leftRight * strokeWidth;
    var i;
    if (strokeKey) {
      for (i = 0; i < numLines; ++i) {
        context.strokeText(lines[i], x + leftRight * widths[i], 0.5 * (strokeWidth + lineHeight) + i * lineHeight);
      }
    }
    if (fillKey) {
      for (i = 0; i < numLines; ++i) {
        context.fillText(lines[i], x + leftRight * widths[i], 0.5 * (strokeWidth + lineHeight) + i * lineHeight);
      }
    }
  }
  return labelCache.get(key);
};

/**
 * @param {CanvasRenderingContext2D} context Context.
 * @param {import("../../coordinate.js").Coordinate} p1 1st point of the background box.
 * @param {import("../../coordinate.js").Coordinate} p2 2nd point of the background box.
 * @param {import("../../coordinate.js").Coordinate} p3 3rd point of the background box.
 * @param {import("../../coordinate.js").Coordinate} p4 4th point of the background box.
 * @param {Array<*>} fillInstruction Fill instruction.
 * @param {Array<*>} strokeInstruction Stroke instruction.
 */
CanvasExecutor.prototype.replayTextBackground_ = function replayTextBackground_ (context, p1, p2, p3, p4, fillInstruction, strokeInstruction) {
  context.beginPath();
  context.moveTo.apply(context, p1);
  context.lineTo.apply(context, p2);
  context.lineTo.apply(context, p3);
  context.lineTo.apply(context, p4);
  context.lineTo.apply(context, p1);
  if (fillInstruction) {
    this.alignFill_ = /** @type {boolean} */ (fillInstruction[2]);
    this.fill_(context);
  }
  if (strokeInstruction) {
    this.setStrokeStyle_(context, /** @type {Array<*>} */ (strokeInstruction));
    context.stroke();
  }
};

/**
 * @param {CanvasRenderingContext2D} context Context.
 * @param {number} x X.
 * @param {number} y Y.
 * @param {HTMLImageElement|HTMLCanvasElement|HTMLVideoElement} image Image.
 * @param {number} anchorX Anchor X.
 * @param {number} anchorY Anchor Y.
 * @param {import("../canvas.js").DeclutterGroup} declutterGroup Declutter group.
 * @param {number} height Height.
 * @param {number} opacity Opacity.
 * @param {number} originX Origin X.
 * @param {number} originY Origin Y.
 * @param {number} rotation Rotation.
 * @param {number} scale Scale.
 * @param {boolean} snapToPixel Snap to pixel.
 * @param {number} width Width.
 * @param {Array<number>} padding Padding.
 * @param {Array<*>} fillInstruction Fill instruction.
 * @param {Array<*>} strokeInstruction Stroke instruction.
 */
CanvasExecutor.prototype.replayImage_ = function replayImage_ (
  context,
  x,
  y,
  image,
  anchorX,
  anchorY,
  declutterGroup,
  height,
  opacity,
  originX,
  originY,
  rotation,
  scale,
  snapToPixel,
  width,
  padding,
  fillInstruction,
  strokeInstruction
) {
  var fillStroke = fillInstruction || strokeInstruction;
  anchorX *= scale;
  anchorY *= scale;
  x -= anchorX;
  y -= anchorY;

  var w = (width + originX > image.width) ? image.width - originX : width;
  var h = (height + originY > image.height) ? image.height - originY : height;
  var boxW = padding[3] + w * scale + padding[1];
  var boxH = padding[0] + h * scale + padding[2];
  var boxX = x - padding[3];
  var boxY = y - padding[0];

  /** @type {import("../../coordinate.js").Coordinate} */
  var p1;
  /** @type {import("../../coordinate.js").Coordinate} */
  var p2;
  /** @type {import("../../coordinate.js").Coordinate} */
  var p3;
  /** @type {import("../../coordinate.js").Coordinate} */
  var p4;
  if (fillStroke || rotation !== 0) {
    p1 = [boxX, boxY];
    p2 = [boxX + boxW, boxY];
    p3 = [boxX + boxW, boxY + boxH];
    p4 = [boxX, boxY + boxH];
  }

  var transform = null;
  if (rotation !== 0) {
    var centerX = x + anchorX;
    var centerY = y + anchorY;
    transform = composeTransform(tmpTransform, centerX, centerY, 1, 1, rotation, -centerX, -centerY);

    createOrUpdateEmpty(tmpExtent);
    extendCoordinate(tmpExtent, applyTransform(tmpTransform, p1));
    extendCoordinate(tmpExtent, applyTransform(tmpTransform, p2));
    extendCoordinate(tmpExtent, applyTransform(tmpTransform, p3));
    extendCoordinate(tmpExtent, applyTransform(tmpTransform, p4));
  } else {
    createOrUpdate(boxX, boxY, boxX + boxW, boxY + boxH, tmpExtent);
  }
  var canvas = context.canvas;
  var strokePadding = strokeInstruction ? (strokeInstruction[2] * scale / 2) : 0;
  var intersects =
      tmpExtent[0] - strokePadding <= canvas.width && tmpExtent[2] + strokePadding >= 0 &&
      tmpExtent[1] - strokePadding <= canvas.height && tmpExtent[3] + strokePadding >= 0;

  if (snapToPixel) {
    x = Math.round(x);
    y = Math.round(y);
  }

  if (declutterGroup) {
    if (!intersects && declutterGroup[4] == 1) {
      return;
    }
    extend(declutterGroup, tmpExtent);
    var declutterArgs = intersects ?
      [context, transform ? transform.slice(0) : null, opacity, image, originX, originY, w, h, x, y, scale] :
      null;
    if (declutterArgs && fillStroke) {
      declutterArgs.push(fillInstruction, strokeInstruction, p1, p2, p3, p4);
    }
    declutterGroup.push(declutterArgs);
  } else if (intersects) {
    if (fillStroke) {
      this.replayTextBackground_(context, p1, p2, p3, p4,
        /** @type {Array<*>} */ (fillInstruction),
        /** @type {Array<*>} */ (strokeInstruction));
    }
    drawImage(context, transform, opacity, image, originX, originY, w, h, x, y, scale);
  }
};

/**
 * @protected
 * @param {Array<number>} dashArray Dash array.
 * @return {Array<number>} Dash array with pixel ratio applied
 */
CanvasExecutor.prototype.applyPixelRatio = function applyPixelRatio (dashArray) {
  var pixelRatio = this.pixelRatio;
  return pixelRatio == 1 ? dashArray : dashArray.map(function(dash) {
    return dash * pixelRatio;
  });
};

/**
 * @private
 * @param {CanvasRenderingContext2D} context Context.
 */
CanvasExecutor.prototype.fill_ = function fill_ (context) {
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
CanvasExecutor.prototype.setStrokeStyle_ = function setStrokeStyle_ (context, instruction) {
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
 * @param {import("../canvas.js").DeclutterGroup} declutterGroup Declutter group.
 * @param {import("../../Feature.js").default|import("../Feature.js").default} feature Feature.
 */
CanvasExecutor.prototype.renderDeclutter_ = function renderDeclutter_ (declutterGroup, feature) {
  if (declutterGroup && declutterGroup.length > 5) {
    var groupCount = declutterGroup[4];
    if (groupCount == 1 || groupCount == declutterGroup.length - 5) {
      /** @type {import("../../structs/RBush.js").Entry} */
      var box = {
        minX: /** @type {number} */ (declutterGroup[0]),
        minY: /** @type {number} */ (declutterGroup[1]),
        maxX: /** @type {number} */ (declutterGroup[2]),
        maxY: /** @type {number} */ (declutterGroup[3]),
        value: feature
      };
      if (!this.declutterTree.collides(box)) {
        this.declutterTree.insert(box);
        for (var j = 5, jj = declutterGroup.length; j < jj; ++j) {
          var declutterData = /** @type {Array} */ (declutterGroup[j]);
          if (declutterData) {
            if (declutterData.length > 11) {
              this.replayTextBackground_(declutterData[0],
                declutterData[13], declutterData[14], declutterData[15], declutterData[16],
                declutterData[11], declutterData[12]);
            }
            drawImage.apply(undefined, declutterData);
          }
        }
      }
      declutterGroup.length = 5;
      createOrUpdateEmpty(declutterGroup);
    }
  }
};

/**
 * @private
 * @param {string} text The text to draw.
 * @param {string} textKey The key of the text state.
 * @param {string} strokeKey The key for the stroke state.
 * @param {string} fillKey The key for the fill state.
 * @return {{label: HTMLCanvasElement, anchorX: number, anchorY: number}} The text image and its anchor.
 */
CanvasExecutor.prototype.drawTextImageWithPointPlacement_ = function drawTextImageWithPointPlacement_ (text, textKey, strokeKey, fillKey) {
  var textState = this.textStates[textKey];

  var label = this.getTextImage(text, textKey, fillKey, strokeKey);

  var strokeState = this.strokeStates[strokeKey];
  var pixelRatio = this.pixelRatio;
  var align = TEXT_ALIGN[textState.textAlign || defaultTextAlign];
  var baseline = TEXT_ALIGN[textState.textBaseline || defaultTextBaseline];
  var strokeWidth = strokeState && strokeState.lineWidth ? strokeState.lineWidth : 0;

  var anchorX = align * label.width / pixelRatio + 2 * (0.5 - align) * strokeWidth;
  var anchorY = baseline * label.height / pixelRatio + 2 * (0.5 - baseline) * strokeWidth;

  return {
    label: label,
    anchorX: anchorX,
    anchorY: anchorY
  };
};

/**
 * @private
 * @param {CanvasRenderingContext2D} context Context.
 * @param {import("../../transform.js").Transform} transform Transform.
 * @param {Object<string, boolean>} skippedFeaturesHash Ids of features
 *   to skip.
 * @param {Array<*>} instructions Instructions array.
 * @param {boolean} snapToPixel Snap point symbols and text to integer pixels.
 * @param {function((import("../../Feature.js").default|import("../Feature.js").default)): T|undefined} featureCallback Feature callback.
 * @param {import("../../extent.js").Extent=} opt_hitExtent Only check features that intersect this
 *   extent.
 * @return {T|undefined} Callback result.
 * @template T
 */
CanvasExecutor.prototype.execute_ = function execute_ (
  context,
  transform,
  skippedFeaturesHash,
  instructions,
  snapToPixel,
  featureCallback,
  opt_hitExtent
) {
  /** @type {Array<number>} */
  var pixelCoordinates;
  if (this.pixelCoordinates_ && equals(transform, this.renderedTransform_)) {
    pixelCoordinates = this.pixelCoordinates_;
  } else {
    if (!this.pixelCoordinates_) {
      this.pixelCoordinates_ = [];
    }
    pixelCoordinates = transform2D(
      this.coordinates, 0, this.coordinates.length, 2,
      transform, this.pixelCoordinates_);
    transformSetFromArray(this.renderedTransform_, transform);
  }
  var skipFeatures = !isEmpty(skippedFeaturesHash);
  var i = 0; // instruction index
  var ii = instructions.length; // end of instructions
  var d = 0; // data index
  var dd; // end of per-instruction data
  var anchorX, anchorY, prevX, prevY, roundX, roundY, declutterGroup, image, text, textKey;
  var strokeKey, fillKey;
  var pendingFill = 0;
  var pendingStroke = 0;
  var lastFillInstruction = null;
  var lastStrokeInstruction = null;
  var coordinateCache = this.coordinateCache_;
  var viewRotation = this.viewRotation_;

  var state = /** @type {import("../../render.js").State} */ ({
    context: context,
    pixelRatio: this.pixelRatio,
    resolution: this.resolution,
    rotation: viewRotation
  });

  // When the batch size gets too big, performance decreases. 200 is a good
  // balance between batch size and number of fill/stroke instructions.
  var batchSize = this.instructions != instructions || this.overlaps ? 0 : 200;
  var /** @type {import("../../Feature.js").default|import("../Feature.js").default} */ feature;
  var x, y;
  while (i < ii) {
    var instruction = instructions[i];
    var type = /** @type {CanvasInstruction} */ (instruction[0]);
    switch (type) {
      case CanvasInstruction.BEGIN_GEOMETRY:
        feature = /** @type {import("../../Feature.js").default|import("../Feature.js").default} */ (instruction[1]);
        if ((skipFeatures && skippedFeaturesHash[getUid(feature)]) || !feature.getGeometry()) {
          i = /** @type {number} */ (instruction[2]);
        } else if (opt_hitExtent !== undefined && !intersects(
          opt_hitExtent, feature.getGeometry().getExtent())) {
          i = /** @type {number} */ (instruction[2]) + 1;
        } else {
          ++i;
        }
        break;
      case CanvasInstruction.BEGIN_PATH:
        if (pendingFill > batchSize) {
          this.fill_(context);
          pendingFill = 0;
        }
        if (pendingStroke > batchSize) {
          context.stroke();
          pendingStroke = 0;
        }
        if (!pendingFill && !pendingStroke) {
          context.beginPath();
          prevX = prevY = NaN;
        }
        ++i;
        break;
      case CanvasInstruction.CIRCLE:
        d = /** @type {number} */ (instruction[1]);
        var x1 = pixelCoordinates[d];
        var y1 = pixelCoordinates[d + 1];
        var x2 = pixelCoordinates[d + 2];
        var y2 = pixelCoordinates[d + 3];
        var dx = x2 - x1;
        var dy = y2 - y1;
        var r = Math.sqrt(dx * dx + dy * dy);
        context.moveTo(x1 + r, y1);
        context.arc(x1, y1, r, 0, 2 * Math.PI, true);
        ++i;
        break;
      case CanvasInstruction.CLOSE_PATH:
        context.closePath();
        ++i;
        break;
      case CanvasInstruction.CUSTOM:
        d = /** @type {number} */ (instruction[1]);
        dd = instruction[2];
        var geometry = /** @type {import("../../geom/SimpleGeometry.js").default} */ (instruction[3]);
        var renderer = instruction[4];
        var fn = instruction.length == 6 ? instruction[5] : undefined;
        state.geometry = geometry;
        state.feature = feature;
        if (!(i in coordinateCache)) {
          coordinateCache[i] = [];
        }
        var coords = coordinateCache[i];
        if (fn) {
          fn(pixelCoordinates, d, dd, 2, coords);
        } else {
          coords[0] = pixelCoordinates[d];
          coords[1] = pixelCoordinates[d + 1];
          coords.length = 2;
        }
        renderer(coords, state);
        ++i;
        break;
      case CanvasInstruction.DRAW_IMAGE:
        d = /** @type {number} */ (instruction[1]);
        dd = /** @type {number} */ (instruction[2]);
        image = /** @type {HTMLCanvasElement|HTMLVideoElement|HTMLImageElement} */ (instruction[3]);

        // Remaining arguments in DRAW_IMAGE are in alphabetical order
        anchorX = /** @type {number} */ (instruction[4]);
        anchorY = /** @type {number} */ (instruction[5]);
        declutterGroup = featureCallback ? null : /** @type {import("../canvas.js").DeclutterGroup} */ (instruction[6]);
        var height = /** @type {number} */ (instruction[7]);
        var opacity = /** @type {number} */ (instruction[8]);
        var originX = /** @type {number} */ (instruction[9]);
        var originY = /** @type {number} */ (instruction[10]);
        var rotateWithView = /** @type {boolean} */ (instruction[11]);
        var rotation = /** @type {number} */ (instruction[12]);
        var scale = /** @type {number} */ (instruction[13]);
        var width = /** @type {number} */ (instruction[14]);


        if (!image && instruction.length >= 19) {
          // create label images
          text = /** @type {string} */ (instruction[18]);
          textKey = /** @type {string} */ (instruction[19]);
          strokeKey = /** @type {string} */ (instruction[20]);
          fillKey = /** @type {string} */ (instruction[21]);
          var labelWithAnchor = this.drawTextImageWithPointPlacement_(text, textKey, strokeKey, fillKey);
          image = instruction[3] = labelWithAnchor.label;
          var textOffsetX = /** @type {number} */ (instruction[22]);
          anchorX = instruction[4] = (labelWithAnchor.anchorX - textOffsetX) * this.pixelRatio;
          var textOffsetY = /** @type {number} */ (instruction[23]);
          anchorY = instruction[5] = (labelWithAnchor.anchorY - textOffsetY) * this.pixelRatio;
          height = instruction[7] = image.height;
          width = instruction[14] = image.width;
        }

        var geometryWidths = (void 0);
        if (instruction.length > 24) {
          geometryWidths = /** @type {number} */ (instruction[24]);
        }

        var padding = (void 0), backgroundFill = (void 0), backgroundStroke = (void 0);
        if (instruction.length > 16) {
          padding = /** @type {Array<number>} */ (instruction[15]);
          backgroundFill = /** @type {boolean} */ (instruction[16]);
          backgroundStroke = /** @type {boolean} */ (instruction[17]);
        } else {
          padding = defaultPadding;
          backgroundFill = backgroundStroke = false;
        }

        if (rotateWithView) {
          rotation += viewRotation;
        }
        var widthIndex = 0;
        for (; d < dd; d += 2) {
          if (geometryWidths && geometryWidths[widthIndex++] < width / this.pixelRatio) {
            continue;
          }
          this.replayImage_(context,
            pixelCoordinates[d], pixelCoordinates[d + 1], image, anchorX, anchorY,
            declutterGroup, height, opacity, originX, originY, rotation, scale,
            snapToPixel, width, padding,
            backgroundFill ? /** @type {Array<*>} */ (lastFillInstruction) : null,
            backgroundStroke ? /** @type {Array<*>} */ (lastStrokeInstruction) : null);
        }
        this.renderDeclutter_(declutterGroup, feature);
        ++i;
        break;
      case CanvasInstruction.DRAW_CHARS:
        var begin = /** @type {number} */ (instruction[1]);
        var end = /** @type {number} */ (instruction[2]);
        var baseline = /** @type {number} */ (instruction[3]);
        declutterGroup = featureCallback ? null : /** @type {import("../canvas.js").DeclutterGroup} */ (instruction[4]);
        var overflow = /** @type {number} */ (instruction[5]);
        fillKey = /** @type {string} */ (instruction[6]);
        var maxAngle = /** @type {number} */ (instruction[7]);
        var measurePixelRatio = /** @type {number} */ (instruction[8]);
        var offsetY = /** @type {number} */ (instruction[9]);
        strokeKey = /** @type {string} */ (instruction[10]);
        var strokeWidth = /** @type {number} */ (instruction[11]);
        text = /** @type {string} */ (instruction[12]);
        textKey = /** @type {string} */ (instruction[13]);
        var pixelRatioScale = /** @type {number} */ (instruction[14]);

        var textState = this.textStates[textKey];
        var font = textState.font;
        var textScale = textState.scale * measurePixelRatio;

        var cachedWidths = (void 0);
        if (font in this.widths_) {
          cachedWidths = this.widths_[font];
        } else {
          cachedWidths = this.widths_[font] = {};
        }

        var pathLength = lineStringLength(pixelCoordinates, begin, end, 2);
        var textLength = textScale * measureAndCacheTextWidth(font, text, cachedWidths);
        if (overflow || textLength <= pathLength) {
          var textAlign = this.textStates[textKey].textAlign;
          var startM = (pathLength - textLength) * TEXT_ALIGN[textAlign];
          var parts = drawTextOnPath(
            pixelCoordinates, begin, end, 2, text, startM, maxAngle, textScale, measureAndCacheTextWidth, font, cachedWidths);
          if (parts) {
            var c = (void 0), cc = (void 0), chars = (void 0), label = (void 0), part = (void 0);
            if (strokeKey) {
              for (c = 0, cc = parts.length; c < cc; ++c) {
                part = parts[c]; // x, y, anchorX, rotation, chunk
                chars = /** @type {string} */ (part[4]);
                label = this.getTextImage(chars, textKey, '', strokeKey);
                anchorX = /** @type {number} */ (part[2]) + strokeWidth;
                anchorY = baseline * label.height + (0.5 - baseline) * 2 * strokeWidth - offsetY;
                this.replayImage_(context,
                  /** @type {number} */ (part[0]), /** @type {number} */ (part[1]), label,
                  anchorX, anchorY, declutterGroup, label.height, 1, 0, 0,
                  /** @type {number} */ (part[3]), pixelRatioScale, false, label.width,
                  defaultPadding, null, null);
              }
            }
            if (fillKey) {
              for (c = 0, cc = parts.length; c < cc; ++c) {
                part = parts[c]; // x, y, anchorX, rotation, chunk
                chars = /** @type {string} */ (part[4]);
                label = this.getTextImage(chars, textKey, fillKey, '');
                anchorX = /** @type {number} */ (part[2]);
                anchorY = baseline * label.height - offsetY;
                this.replayImage_(context,
                  /** @type {number} */ (part[0]), /** @type {number} */ (part[1]), label,
                  anchorX, anchorY, declutterGroup, label.height, 1, 0, 0,
                  /** @type {number} */ (part[3]), pixelRatioScale, false, label.width,
                  defaultPadding, null, null);
              }
            }
          }
        }
        this.renderDeclutter_(declutterGroup, feature);
        ++i;
        break;
      case CanvasInstruction.END_GEOMETRY:
        if (featureCallback !== undefined) {
          feature = /** @type {import("../../Feature.js").default|import("../Feature.js").default} */ (instruction[1]);
          var result = featureCallback(feature);
          if (result) {
            return result;
          }
        }
        ++i;
        break;
      case CanvasInstruction.FILL:
        if (batchSize) {
          pendingFill++;
        } else {
          this.fill_(context);
        }
        ++i;
        break;
      case CanvasInstruction.MOVE_TO_LINE_TO:
        d = /** @type {number} */ (instruction[1]);
        dd = /** @type {number} */ (instruction[2]);
        x = pixelCoordinates[d];
        y = pixelCoordinates[d + 1];
        roundX = (x + 0.5) | 0;
        roundY = (y + 0.5) | 0;
        if (roundX !== prevX || roundY !== prevY) {
          context.moveTo(x, y);
          prevX = roundX;
          prevY = roundY;
        }
        for (d += 2; d < dd; d += 2) {
          x = pixelCoordinates[d];
          y = pixelCoordinates[d + 1];
          roundX = (x + 0.5) | 0;
          roundY = (y + 0.5) | 0;
          if (d == dd - 2 || roundX !== prevX || roundY !== prevY) {
            context.lineTo(x, y);
            prevX = roundX;
            prevY = roundY;
          }
        }
        ++i;
        break;
      case CanvasInstruction.SET_FILL_STYLE:
        lastFillInstruction = instruction;
        this.alignFill_ = instruction[2];

        if (pendingFill) {
          this.fill_(context);
          pendingFill = 0;
          if (pendingStroke) {
            context.stroke();
            pendingStroke = 0;
          }
        }

        context.fillStyle = /** @type {import("../../colorlike.js").ColorLike} */ (instruction[1]);
        ++i;
        break;
      case CanvasInstruction.SET_STROKE_STYLE:
        lastStrokeInstruction = instruction;
        if (pendingStroke) {
          context.stroke();
          pendingStroke = 0;
        }
        this.setStrokeStyle_(context, /** @type {Array<*>} */ (instruction));
        ++i;
        break;
      case CanvasInstruction.STROKE:
        if (batchSize) {
          pendingStroke++;
        } else {
          context.stroke();
        }
        ++i;
        break;
      default:
        ++i; // consume the instruction anyway, to avoid an infinite loop
        break;
    }
  }
  if (pendingFill) {
    this.fill_(context);
  }
  if (pendingStroke) {
    context.stroke();
  }
  return undefined;
};

/**
 * @param {CanvasRenderingContext2D} context Context.
 * @param {import("../../transform.js").Transform} transform Transform.
 * @param {number} viewRotation View rotation.
 * @param {Object<string, boolean>} skippedFeaturesHash Ids of features
 *   to skip.
 * @param {boolean} snapToPixel Snap point symbols and text to integer pixels.
 */
CanvasExecutor.prototype.execute = function execute (context, transform, viewRotation, skippedFeaturesHash, snapToPixel) {
  this.viewRotation_ = viewRotation;
  this.execute_(context, transform,
    skippedFeaturesHash, this.instructions, snapToPixel, undefined, undefined);
};

/**
 * @param {CanvasRenderingContext2D} context Context.
 * @param {import("../../transform.js").Transform} transform Transform.
 * @param {number} viewRotation View rotation.
 * @param {Object<string, boolean>} skippedFeaturesHash Ids of features
 *   to skip.
 * @param {function((import("../../Feature.js").default|import("../Feature.js").default)): T=} opt_featureCallback
 *   Feature callback.
 * @param {import("../../extent.js").Extent=} opt_hitExtent Only check features that intersect this
 *   extent.
 * @return {T|undefined} Callback result.
 * @template T
 */
CanvasExecutor.prototype.executeHitDetection = function executeHitDetection (
  context,
  transform,
  viewRotation,
  skippedFeaturesHash,
  opt_featureCallback,
  opt_hitExtent
) {
  this.viewRotation_ = viewRotation;
  return this.execute_(context, transform, skippedFeaturesHash,
    this.hitDetectionInstructions, true, opt_featureCallback, opt_hitExtent);
};

/**
 * Reverse the hit detection instructions.
 */
CanvasExecutor.prototype.reverseHitDetectionInstructions = function reverseHitDetectionInstructions () {
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
 * @param {import("../canvas.js").FillStrokeState} state State.
 * @param {import("../../geom/Geometry.js").default|import("../Feature.js").default} geometry Geometry.
 * @return {Array<*>} Fill instruction.
 */
CanvasExecutor.prototype.createFill = function createFill (state, geometry) {
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
 * @return {Array<*>} Stroke instruction.
 */
CanvasExecutor.prototype.createStroke = function createStroke (state) {
  return [
    CanvasInstruction.SET_STROKE_STYLE,
    state.strokeStyle, state.lineWidth * this.pixelRatio, state.lineCap,
    state.lineJoin, state.miterLimit,
    this.applyPixelRatio(state.lineDash), state.lineDashOffset * this.pixelRatio
  ];
};


/**
 * Get the buffered rendering extent.Rendering will be clipped to the extent
 * provided to the constructor.To account for symbolizers that may intersect
 * this extent, we calculate a buffered extent (e.g. based on stroke width).
 * @return {import("../../extent.js").Extent} The buffered rendering extent.
 * @protected
 */
CanvasExecutor.prototype.getBufferedMaxExtent = function getBufferedMaxExtent () {
  if (!this.bufferedMaxExtent_) {
    this.bufferedMaxExtent_ = clone(this.maxExtent);
    if (this.maxLineWidth > 0) {
      var width = this.resolution * (this.maxLineWidth + 1) / 2;
      buffer(this.bufferedMaxExtent_, width, this.bufferedMaxExtent_);
    }
  }
  return this.bufferedMaxExtent_;
};


export default CanvasExecutor;

//# sourceMappingURL=Executor.js.map