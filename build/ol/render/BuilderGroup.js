/**
 * @module ol/render/BuilderGroup
 */
import {abstract} from '../util.js';

/**
 * Base class for builder groups.
 */
var BuilderGroup = function BuilderGroup () {};

BuilderGroup.prototype.getBuilder = function getBuilder (zIndex, replayType) {
  return abstract();
};

/**
 * @abstract
 * @return {boolean} Is empty.
 */
BuilderGroup.prototype.isEmpty = function isEmpty () {
  return abstract();
};

/**
 * @abstract
 * @param {boolean} group Group with previous builder
 * @return {Array<*>} The resulting instruction group
 */
BuilderGroup.prototype.addDeclutter = function addDeclutter (group) {
  return abstract();
};

export default BuilderGroup;

//# sourceMappingURL=BuilderGroup.js.map