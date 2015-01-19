'user strict';

var util = require('util');
var path = require('path');
var utils = require('./utils');
var EventEmitter = require('events').EventEmitter;

/**
 * Create an mencoder command
 *
 * Can be called with or without 'new' operator
 *
 * @constructor
 * @param {Number} [options.niceness=0] mencoder process niceness, ignored on Windows
 * @param {Number} [options.timeout=<no-timeout>] mencoder processing timeout in seconds
 */
function MencoderCommand(options){
  // Make 'new' optional
  if (! this instanceof MencoderCommand) {
    return new MencoderCommand(options);
  }

  EventEmitter.call(this);

  options = options || {};

  this._inputs = [];
  this._outputs = [];
  this.output();


  var self = this;
  ['_global','_complexFilters'].forEach(function(prop){
    self[prop] = utils.args();
  });

  // Set default option values
  options.presets = options.presets || options.preset || path.join(__dirname, 'presets');
  options.niceness = options.niceness || options.priority || 0;

  // Save options
  this.options = options;

}

util.inherits(MencoderCommand, EventEmitter);
MencoderCommand.prototype.addInput = function(){
  console.log("Prova add input");
};
require('./options/inputs')(MencoderCommand.prototype);
require('./options/output')(MencoderCommand.prototype);
require('./processor')(MencoderCommand.prototype);
require('./recipes')(MencoderCommand.prototype);
require('./capabilities')(MencoderCommand.prototype);

module.exports = MencoderCommand;
