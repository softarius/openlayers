/**
 * @module ol/render/canvas/ExecutorGroup
 */

import {numberSafeCompareFunction} from '../../array.js';
import {createCanvasContext2D} from '../../dom.js';
import {buffer, createEmpty, extendCoordinate} from '../../extent.js';
import {transform2D} from '../../geom/flat/transform.js';
import {isEmpty} from '../../obj.js';
import BaseExecutorGroup from '../ExecutorGroup.js';
import ReplayType from '../ReplayType.js';
import {ORDER} from '../replay.js';
import {create as createTransform, compose as composeTransform} from '../../transform.js';
import CanvasExecutor from './Executor.js';


var ExecutorGroup = /*@__PURE__*/(function (BaseExecutorGroup) {
  function ExecutorGroup(
    tolerance,
    maxExtent,
    resolution,
    pixelRatio,
    overlaps,
    declutterTree,
    allInstructions,
    opt_renderBuffer
  ) {
    BaseExecutorGroup.call(this);

    /**
     * Declutter tree.
     * @private
     */
    this.declutterTree_ = declutterTree;

    /**
     * @type {import("../canvas.js").DeclutterGroup}
     * @private
     */
    this.declutterGroup_ = null;

    /**
     * @private
     * @type {number}
     */
    this.tolerance_ = tolerance;

    /**
     * @private
     * @type {import("../../extent.js").Extent}
     */
    this.maxExtent_ = maxExtent;

    /**
     * @private
     * @type {boolean}
     */
    this.overlaps_ = overlaps;

    /**
     * @private
     * @type {number}
     */
    this.pixelRatio_ = pixelRatio;

    /**
     * @private
     * @type {number}
     */
    this.resolution_ = resolution;

    /**
     * @private
     * @type {number|undefined}
     */
    this.renderBuffer_ = opt_renderBuffer;

    /**
     * @private
     * @type {!Object<string, !Object<ReplayType, import("./Executor").default>>}
     */
    this.executorsByZIndex_ = {};

    /**
     * @private
     * @type {CanvasRenderingContext2D}
     */
    this.hitDetectionContext_ = createCanvasContext2D(1, 1);

    /**
     * @private
     * @type {import("../../transform.js").Transform}
     */
    this.hitDetectionTransform_ = createTransform();

    this.createExectutors_(allInstructions);
  }

  if ( BaseExecutorGroup ) ExecutorGroup.__proto__ = BaseExecutorGroup;
  ExecutorGroup.prototype = Object.create( BaseExecutorGroup && BaseExecutorGroup.prototype );
  ExecutorGroup.prototype.constructor = ExecutorGroup;

  /**
   * @param {CanvasRenderingContext2D} context Context.
   * @param {import("../../transform.js").Transform} transform Transform.
   */
  ExecutorGroup.prototype.clip = function clip (context, transform) {
    var flatClipCoords = this.getClipCoords(transform);
    context.beginPath();
    context.moveTo(flatClipCoords[0], flatClipCoords[1]);
    context.lineTo(flatClipCoords[2], flatClipCoords[3]);
    context.lineTo(flatClipCoords[4], flatClipCoords[5]);
    context.lineTo(flatClipCoords[6], flatClipCoords[7]);
    context.clip();
  };

  /**
   * Create executors and populate them using the provided instructions.
   * @private
   * @param {!Object<string, !Object<ReplayType, import("./Builder.js").SerializableInstructions>>} allInstructions The serializable instructions
   */
  ExecutorGroup.prototype.createExectutors_ = function createExectutors_ (allInstructions) {
    for (var zIndex in allInstructions) {
      var executors = this.executorsByZIndex_[zIndex];
      if (executors === undefined) {
        this.executorsByZIndex_[zIndex] = executors = {};
      }
      var instructionByZindex = allInstructions[zIndex];
      for (var replayType in instructionByZindex) {
        var instructions = instructionByZindex[replayType];
        executors[replayType] = new CanvasExecutor(this.tolerance_, this.maxExtent_,
          this.resolution_, this.pixelRatio_, this.overlaps_, this.declutterTree_, instructions);
      }
    }
  };

  /**
   * @param {Array<ReplayType>} executors Executors.
   * @return {boolean} Has executors of the provided types.
   */
  ExecutorGroup.prototype.hasExecutors = function hasExecutors (executors) {
    for (var zIndex in this.executorsByZIndex_) {
      var candidates = this.executorsByZIndex_[zIndex];
      for (var i = 0, ii = executors.length; i < ii; ++i) {
        if (executors[i] in candidates) {
          return true;
        }
      }
    }
    return false;
  };


  /**
   * @param {import("../../coordinate.js").Coordinate} coordinate Coordinate.
   * @param {number} resolution Resolution.
   * @param {number} rotation Rotation.
   * @param {number} hitTolerance Hit tolerance in pixels.
   * @param {Object<string, boolean>} skippedFeaturesHash Ids of features to skip.
   * @param {function((import("../../Feature.js").default|import("../Feature.js").default)): T} callback Feature callback.
   * @param {Object<string, import("../canvas.js").DeclutterGroup>} declutterReplays Declutter replays.
   * @return {T|undefined} Callback result.
   * @template T
   */
  ExecutorGroup.prototype.forEachFeatureAtCoordinate = function forEachFeatureAtCoordinate (
    coordinate,
    resolution,
    rotation,
    hitTolerance,
    skippedFeaturesHash,
    callback,
    declutterReplays
  ) {

    hitTolerance = Math.round(hitTolerance);
    var contextSize = hitTolerance * 2 + 1;
    var transform = composeTransform(this.hitDetectionTransform_,
      hitTolerance + 0.5, hitTolerance + 0.5,
      1 / resolution, -1 / resolution,
      -rotation,
      -coordinate[0], -coordinate[1]);
    var context = this.hitDetectionContext_;

    if (context.canvas.width !== contextSize || context.canvas.height !== contextSize) {
      context.canvas.width = contextSize;
      context.canvas.height = contextSize;
    } else {
      context.clearRect(0, 0, contextSize, contextSize);
    }

    /**
     * @type {import("../../extent.js").Extent}
     */
    var hitExtent;
    if (this.renderBuffer_ !== undefined) {
      hitExtent = createEmpty();
      extendCoordinate(hitExtent, coordinate);
      buffer(hitExtent, resolution * (this.renderBuffer_ + hitTolerance), hitExtent);
    }

    var mask = getCircleArray(hitTolerance);
    var declutteredFeatures;
    if (this.declutterTree_) {
      declutteredFeatures = this.declutterTree_.all().map(function(entry) {
        return entry.value;
      });
    }

    var replayType;

    /**
     * @param {import("../../Feature.js").default|import("../Feature.js").default} feature Feature.
     * @return {?} Callback result.
     */
    function featureCallback(feature) {
      var imageData = context.getImageData(0, 0, contextSize, contextSize).data;
      for (var i = 0; i < contextSize; i++) {
        for (var j = 0; j < contextSize; j++) {
          if (mask[i][j]) {
            if (imageData[(j * contextSize + i) * 4 + 3] > 0) {
              var result = (void 0);
              if (!(declutteredFeatures && (replayType == ReplayType.IMAGE || replayType == ReplayType.TEXT)) ||
                  declutteredFeatures.indexOf(feature) !== -1) {
                result = callback(feature);
              }
              if (result) {
                return result;
              } else {
                context.clearRect(0, 0, contextSize, contextSize);
                return undefined;
              }
            }
          }
        }
      }
    }

    /** @type {Array<number>} */
    var zs = Object.keys(this.executorsByZIndex_).map(Number);
    zs.sort(numberSafeCompareFunction);

    var i, j, executors, executor, result;
    for (i = zs.length - 1; i >= 0; --i) {
      var zIndexKey = zs[i].toString();
      executors = this.executorsByZIndex_[zIndexKey];
      for (j = ORDER.length - 1; j >= 0; --j) {
        replayType = ORDER[j];
        executor = executors[replayType];
        if (executor !== undefined) {
          if (declutterReplays &&
              (replayType == ReplayType.IMAGE || replayType == ReplayType.TEXT)) {
            var declutter = declutterReplays[zIndexKey];
            if (!declutter) {
              declutterReplays[zIndexKey] = [executor, transform.slice(0)];
            } else {
              declutter.push(executor, transform.slice(0));
            }
          } else {
            result = executor.executeHitDetection(context, transform, rotation,
              skippedFeaturesHash, featureCallback, hitExtent);
            if (result) {
              return result;
            }
          }
        }
      }
    }
    return undefined;
  };

  /**
   * @param {import("../../transform.js").Transform} transform Transform.
   * @return {Array<number>} Clip coordinates.
   */
  ExecutorGroup.prototype.getClipCoords = function getClipCoords (transform) {
    var maxExtent = this.maxExtent_;
    var minX = maxExtent[0];
    var minY = maxExtent[1];
    var maxX = maxExtent[2];
    var maxY = maxExtent[3];
    var flatClipCoords = [minX, minY, minX, maxY, maxX, maxY, maxX, minY];
    transform2D(
      flatClipCoords, 0, 8, 2, transform, flatClipCoords);
    return flatClipCoords;
  };

  /**
   * @return {import("../../extent.js").Extent} The extent of the replay group.
   */
  ExecutorGroup.prototype.getMaxExtent = function getMaxExtent () {
    return this.maxExtent_;
  };

  /**
   * @inheritDoc
   */
  ExecutorGroup.prototype.getExecutor = function getExecutor (zIndex, replayType) {
    var zIndexKey = zIndex !== undefined ? zIndex.toString() : '0';
    var executors = this.executorsByZIndex_[zIndexKey];
    if (executors === undefined) {
      executors = {};
      this.executorsByZIndex_[zIndexKey] = executors;
    }
    var executor = executors[replayType];
    if (executor === undefined) {
      // FIXME: it should not be possible to ask for an executor that does not exist
      executor = new CanvasExecutor(this.tolerance_, this.maxExtent_,
        this.resolution_, this.pixelRatio_, this.overlaps_, {
          instructions: [],
          hitDetectionInstructions: [],
          coordinates: []
        },
        this.declutterTree_);
      executors[replayType] = executor;
    }
    return executor;
  };

  /**
   * @return {Object<string, Object<ReplayType, CanvasReplay>>} Replays.
   */
  ExecutorGroup.prototype.getExecutors = function getExecutors () {
    return this.executorsByZIndex_;
  };

  /**
   * @inheritDoc
   */
  ExecutorGroup.prototype.isEmpty = function isEmpty$1 () {
    return isEmpty(this.executorsByZIndex_);
  };

  /**
   * @param {CanvasRenderingContext2D} context Context.
   * @param {import("../../transform.js").Transform} transform Transform.
   * @param {number} viewRotation View rotation.
   * @param {Object<string, boolean>} skippedFeaturesHash Ids of features to skip.
   * @param {boolean} snapToPixel Snap point symbols and test to integer pixel.
   * @param {Array<ReplayType>=} opt_replayTypes Ordered replay types to replay.
   *     Default is {@link module:ol/render/replay~ORDER}
   * @param {Object<string, import("../canvas.js").DeclutterGroup>=} opt_declutterReplays Declutter replays.
   */
  ExecutorGroup.prototype.execute = function execute (
    context,
    transform,
    viewRotation,
    skippedFeaturesHash,
    snapToPixel,
    opt_replayTypes,
    opt_declutterReplays
  ) {

    /** @type {Array<number>} */
    var zs = Object.keys(this.executorsByZIndex_).map(Number);
    zs.sort(numberSafeCompareFunction);

    // setup clipping so that the parts of over-simplified geometries are not
    // visible outside the current extent when panning
    context.save();
    this.clip(context, transform);

    var replayTypes = opt_replayTypes ? opt_replayTypes : ORDER;
    var i, ii, j, jj, replays, replay;
    for (i = 0, ii = zs.length; i < ii; ++i) {
      var zIndexKey = zs[i].toString();
      replays = this.executorsByZIndex_[zIndexKey];
      for (j = 0, jj = replayTypes.length; j < jj; ++j) {
        var replayType = replayTypes[j];
        replay = replays[replayType];
        if (replay !== undefined) {
          if (opt_declutterReplays &&
              (replayType == ReplayType.IMAGE || replayType == ReplayType.TEXT)) {
            var declutter = opt_declutterReplays[zIndexKey];
            if (!declutter) {
              opt_declutterReplays[zIndexKey] = [replay, transform.slice(0)];
            } else {
              declutter.push(replay, transform.slice(0));
            }
          } else {
            replay.execute(context, transform, viewRotation, skippedFeaturesHash, snapToPixel);
          }
        }
      }
    }

    context.restore();
  };

  return ExecutorGroup;
}(BaseExecutorGroup));


/**
 * This cache is used for storing calculated pixel circles for increasing performance.
 * It is a static property to allow each Replaygroup to access it.
 * @type {Object<number, Array<Array<(boolean|undefined)>>>}
 */
var circleArrayCache = {
  0: [[true]]
};


/**
 * This method fills a row in the array from the given coordinate to the
 * middle with `true`.
 * @param {Array<Array<(boolean|undefined)>>} array The array that will be altered.
 * @param {number} x X coordinate.
 * @param {number} y Y coordinate.
 */
function fillCircleArrayRowToMiddle(array, x, y) {
  var i;
  var radius = Math.floor(array.length / 2);
  if (x >= radius) {
    for (i = radius; i < x; i++) {
      array[i][y] = true;
    }
  } else if (x < radius) {
    for (i = x + 1; i < radius; i++) {
      array[i][y] = true;
    }
  }
}


/**
 * This methods creates a circle inside a fitting array. Points inside the
 * circle are marked by true, points on the outside are undefined.
 * It uses the midpoint circle algorithm.
 * A cache is used to increase performance.
 * @param {number} radius Radius.
 * @returns {Array<Array<(boolean|undefined)>>} An array with marked circle points.
 */
export function getCircleArray(radius) {
  if (circleArrayCache[radius] !== undefined) {
    return circleArrayCache[radius];
  }

  var arraySize = radius * 2 + 1;
  var arr = new Array(arraySize);
  for (var i = 0; i < arraySize; i++) {
    arr[i] = new Array(arraySize);
  }

  var x = radius;
  var y = 0;
  var error = 0;

  while (x >= y) {
    fillCircleArrayRowToMiddle(arr, radius + x, radius + y);
    fillCircleArrayRowToMiddle(arr, radius + y, radius + x);
    fillCircleArrayRowToMiddle(arr, radius - y, radius + x);
    fillCircleArrayRowToMiddle(arr, radius - x, radius + y);
    fillCircleArrayRowToMiddle(arr, radius - x, radius - y);
    fillCircleArrayRowToMiddle(arr, radius - y, radius - x);
    fillCircleArrayRowToMiddle(arr, radius + y, radius - x);
    fillCircleArrayRowToMiddle(arr, radius + x, radius - y);

    y++;
    error += 1 + 2 * y;
    if (2 * (error - x) + 1 > 0) {
      x -= 1;
      error += 1 - 2 * x;
    }
  }

  circleArrayCache[radius] = arr;
  return arr;
}


/**
 * @param {!Object<string, Array<*>>} declutterReplays Declutter replays.
 * @param {CanvasRenderingContext2D} context Context.
 * @param {number} rotation Rotation.
 * @param {boolean} snapToPixel Snap point symbols and text to integer pixels.
 */
export function replayDeclutter(declutterReplays, context, rotation, snapToPixel) {
  var zs = Object.keys(declutterReplays).map(Number).sort(numberSafeCompareFunction);
  var skippedFeatureUids = {};
  for (var z = 0, zz = zs.length; z < zz; ++z) {
    var executorData = declutterReplays[zs[z].toString()];
    for (var i = 0, ii = executorData.length; i < ii;) {
      var executor = executorData[i++];
      var transform = executorData[i++];
      executor.execute(context, transform, rotation, skippedFeatureUids, snapToPixel);
    }
  }
}


export default ExecutorGroup;

//# sourceMappingURL=ExecutorGroup.js.map