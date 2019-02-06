/**
 * @module ol/layer/VectorImage
 */
import BaseVectorLayer from './BaseVector.js';
import CanvasVectorImageLayerRenderer from '../renderer/canvas/VectorImageLayer.js';

/**
 * @typedef {import("./BaseVector.js").Options} Options
 */


/**
 * @classdesc
 * Vector data that is rendered client-side.
 * Note that any property set in the options is set as a {@link module:ol/Object~BaseObject}
 * property on the layer object; for example, setting `title: 'My Title'` in the
 * options means that `title` is observable, and has get/set accessors.
 *
 * @api
 */
var VectorImageLayer = /*@__PURE__*/(function (BaseVectorLayer) {
  function VectorImageLayer(opt_options) {
    BaseVectorLayer.call(this, opt_options);
  }

  if ( BaseVectorLayer ) VectorImageLayer.__proto__ = BaseVectorLayer;
  VectorImageLayer.prototype = Object.create( BaseVectorLayer && BaseVectorLayer.prototype );
  VectorImageLayer.prototype.constructor = VectorImageLayer;

  /**
   * Create a renderer for this layer.
   * @return {import("../renderer/Layer.js").default} A layer renderer.
   * @protected
   */
  VectorImageLayer.prototype.createRenderer = function createRenderer () {
    return new CanvasVectorImageLayerRenderer(this);
  };

  return VectorImageLayer;
}(BaseVectorLayer));


export default VectorImageLayer;

//# sourceMappingURL=VectorImage.js.map