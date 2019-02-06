/**
 * @module ol/renderer/canvas/ImageLayer
 */
import ImageCanvas from '../../ImageCanvas.js';
import ViewHint from '../../ViewHint.js';
import {equals} from '../../array.js';
import {getHeight, getWidth, isEmpty} from '../../extent.js';
import {assign} from '../../obj.js';
import CanvasImageLayerRenderer from './ImageLayer.js';
import CanvasVectorLayerRenderer from './VectorLayer.js';

/**
 * @classdesc
 * Canvas renderer for image layers.
 * @api
 */
var CanvasVectorImageLayerRenderer = /*@__PURE__*/(function (CanvasImageLayerRenderer) {
  function CanvasVectorImageLayerRenderer(layer) {
    CanvasImageLayerRenderer.call(this, layer);

    /**
     * @type {!Array<string>}
     */
    this.skippedFeatures_ = [];

    /**
     * @private
     * @type {import("./VectorLayer.js").default}
     */
    this.vectorRenderer_ = new CanvasVectorLayerRenderer(layer);

  }

  if ( CanvasImageLayerRenderer ) CanvasVectorImageLayerRenderer.__proto__ = CanvasImageLayerRenderer;
  CanvasVectorImageLayerRenderer.prototype = Object.create( CanvasImageLayerRenderer && CanvasImageLayerRenderer.prototype );
  CanvasVectorImageLayerRenderer.prototype.constructor = CanvasVectorImageLayerRenderer;

  /**
   * @inheritDoc
   */
  CanvasVectorImageLayerRenderer.prototype.disposeInternal = function disposeInternal () {
    this.vectorRenderer_.dispose();
    CanvasImageLayerRenderer.prototype.disposeInternal.call(this);
  };

  /**
   * @inheritDoc
   */
  CanvasVectorImageLayerRenderer.prototype.prepareFrame = function prepareFrame (frameState, layerState) {
    var pixelRatio = frameState.pixelRatio;
    var viewState = frameState.viewState;
    var viewResolution = viewState.resolution;

    var hints = frameState.viewHints;
    var vectorRenderer = this.vectorRenderer_;
    var renderedExtent = frameState.extent;

    if (!hints[ViewHint.ANIMATING] && !hints[ViewHint.INTERACTING] && !isEmpty(renderedExtent)) {
      var skippedFeatures = this.skippedFeatures_;
      var context = vectorRenderer.context;
      var imageFrameState = /** @type {import("../../PluggableMap.js").FrameState} */ (assign({}, frameState, {
        size: [
          getWidth(renderedExtent) / viewResolution,
          getHeight(renderedExtent) / viewResolution
        ],
        viewState: /** @type {import("../../View.js").State} */ (assign({}, frameState.viewState, {
          rotation: 0
        }))
      }));
      var newSkippedFeatures = Object.keys(imageFrameState.skippedFeatureUids).sort();
      var image = new ImageCanvas(renderedExtent, viewResolution, pixelRatio, context.canvas, function(callback) {
        if (vectorRenderer.prepareFrame(imageFrameState, layerState) &&
              (vectorRenderer.replayGroupChanged ||
              !equals(skippedFeatures, newSkippedFeatures))) {
          context.canvas.width = imageFrameState.size[0] * pixelRatio;
          context.canvas.height = imageFrameState.size[1] * pixelRatio;
          vectorRenderer.renderFrame(imageFrameState, layerState);
          skippedFeatures = newSkippedFeatures;
          callback();
        }
      });
      if (this.loadImage(image)) {
        this.image_ = image;
        this.skippedFeatures_ = skippedFeatures;
      }
    }

    if (this.image_) {
      var image$1 = this.image_;
      var imageResolution = image$1.getResolution();
      var imagePixelRatio = image$1.getPixelRatio();
      this.renderedResolution = imageResolution * pixelRatio / imagePixelRatio;
    }

    return !!this.image_;
  };

  /**
   * @inheritDoc
   */
  CanvasVectorImageLayerRenderer.prototype.forEachFeatureAtCoordinate = function forEachFeatureAtCoordinate (coordinate, frameState, hitTolerance, callback) {
    if (this.vectorRenderer_) {
      return this.vectorRenderer_.forEachFeatureAtCoordinate(coordinate, frameState, hitTolerance, callback);
    } else {
      return CanvasImageLayerRenderer.prototype.forEachFeatureAtCoordinate.call(this, coordinate, frameState, hitTolerance, callback);
    }
  };

  return CanvasVectorImageLayerRenderer;
}(CanvasImageLayerRenderer));


export default CanvasVectorImageLayerRenderer;

//# sourceMappingURL=VectorImageLayer.js.map