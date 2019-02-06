/**
 * @module ol/render/ExecutorGroup
 */
import {abstract} from '../util.js';

/**
 * Base class for replay groups.
 */
var ExecutorGroup = function ExecutorGroup () {};

ExecutorGroup.prototype.getExecutor = function getExecutor (zIndex, replayType) {
  return abstract();
};

/**
 * @abstract
 * @return {boolean} Is empty.
 */
ExecutorGroup.prototype.isEmpty = function isEmpty () {
  return abstract();
};

/**
 * @return {import("../extent.js").Extent} The extent of the group.
 */
ExecutorGroup.prototype.getMaxExtent = function getMaxExtent () {
  return abstract();
};

/**
 * @abstract
 * @param {boolean} group Group with previous executor
 * @return {Array<*>} The resulting instruction group
 */
ExecutorGroup.prototype.addDeclutter = function addDeclutter (group) {
  return abstract();
};

export default ExecutorGroup;

//# sourceMappingURL=ExecutorGroup.js.map