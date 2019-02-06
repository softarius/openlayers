/**
 * @module ol/renderer/canvas/Map
 */
import {CLASS_UNSELECTABLE} from '../css.js';
import {visibleAtResolution} from '../layer/Layer.js';
import RenderEvent from '../render/Event.js';
import RenderEventType from '../render/EventType.js';
import MapRenderer from './Map.js';
import SourceState from '../source/State.js';
import {replaceChildren} from '../dom.js';


/**
 * @classdesc
 * Canvas map renderer.
 * @api
 */
var CompositeMapRenderer = /*@__PURE__*/(function (MapRenderer) {
  function CompositeMapRenderer(map) {
    MapRenderer.call(this, map);

    /**
     * @private
     * @type {HTMLDivElement}
     */
    this.element_ = document.createElement('div');
    var style = this.element_.style;
    style.position = 'absolute';
    style.width = '100%';
    style.height = '100%';
    style.zIndex = '0';

    this.element_.className = CLASS_UNSELECTABLE + ' ol-layers';

    var container = map.getViewport();
    container.insertBefore(this.element_, container.firstChild || null);

    /**
     * @private
     * @type {Array<HTMLElement>}
     */
    this.children_ = [];

    /**
     * @private
     * @type {boolean}
     */
    this.renderedVisible_ = true;
  }

  if ( MapRenderer ) CompositeMapRenderer.__proto__ = MapRenderer;
  CompositeMapRenderer.prototype = Object.create( MapRenderer && MapRenderer.prototype );
  CompositeMapRenderer.prototype.constructor = CompositeMapRenderer;

  /**
   * @param {import("../render/EventType.js").default} type Event type.
   * @param {import("../PluggableMap.js").FrameState} frameState Frame state.
   */
  CompositeMapRenderer.prototype.dispatchRenderEvent = function dispatchRenderEvent (type, frameState) {
    var map = this.getMap();
    if (map.hasListener(type)) {
      var event = new RenderEvent(type, undefined, frameState);
      map.dispatchEvent(event);
    }
  };

  /**
   * @inheritDoc
   */
  CompositeMapRenderer.prototype.renderFrame = function renderFrame (frameState) {
    if (!frameState) {
      if (this.renderedVisible_) {
        this.element_.style.display = 'none';
        this.renderedVisible_ = false;
      }
      return;
    }

    this.calculateMatrices2D(frameState);
    this.dispatchRenderEvent(RenderEventType.PRECOMPOSE, frameState);

    var layerStatesArray = frameState.layerStatesArray;
    var viewResolution = frameState.viewState.resolution;

    this.children_.length = 0;
    for (var i = 0, ii = layerStatesArray.length; i < ii; ++i) {
      var layerState = layerStatesArray[i];
      if (!visibleAtResolution(layerState, viewResolution) || layerState.sourceState != SourceState.READY) {
        continue;
      }

      var layer = layerState.layer;
      var element = layer.render(frameState);
      if (element) {
        var zIndex = layerState.zIndex;
        if (zIndex !== element.style.zIndex) {
          element.style.zIndex = zIndex;
        }
        this.children_.push(element);
      }
    }

    replaceChildren(this.element_, this.children_);

    this.dispatchRenderEvent(RenderEventType.POSTCOMPOSE, frameState);

    if (!this.renderedVisible_) {
      this.element_.style.display = '';
      this.renderedVisible_ = true;
    }

    this.scheduleRemoveUnusedLayerRenderers(frameState);
    this.scheduleExpireIconCache(frameState);
  };

  /**
   * @inheritDoc
   */
  CompositeMapRenderer.prototype.forEachLayerAtPixel = function forEachLayerAtPixel (pixel, frameState, hitTolerance, callback, layerFilter) {
    var viewState = frameState.viewState;
    var viewResolution = viewState.resolution;

    var layerStates = frameState.layerStatesArray;
    var numLayers = layerStates.length;

    for (var i = numLayers - 1; i >= 0; --i) {
      var layerState = layerStates[i];
      var layer = layerState.layer;
      if (visibleAtResolution(layerState, viewResolution) && layerFilter(layer)) {
        var layerRenderer = this.getLayerRenderer(layer);
        if (!layerRenderer) {
          continue;
        }
        var data = layerRenderer.getDataAtPixel(pixel, frameState, hitTolerance);
        if (data) {
          var result = callback(layer, data);
          if (result) {
            return result;
          }
        }
      }
    }
    return undefined;
  };

  return CompositeMapRenderer;
}(MapRenderer));


export default CompositeMapRenderer;

//# sourceMappingURL=Composite.js.map