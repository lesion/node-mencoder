/*jshint node:true*/
'use strict';

var spawn = require('child_process').spawn;
var path = require('path');
var fs = require('fs');
var async = require('async');
var utils = require('./utils');


/*
 *! Processor methods
 */


/**
 * Run ffprobe asynchronously and store data in command
 *
 * @param {MencoderCommand} command
 * @private
 */
function runFfprobe(command) {
  command.ffprobe(0, function(err, data) {
    command._ffprobeData = data;
  });
}


module.exports = function(proto) {
  /**
   * Emitted just after mencoder has been spawned.
   *
   * @event MencoderCommand#start
   * @param {String} command mencoder command line
   */

  /**
   * Emitted when mencoder reports progress information
   *
   * @event MencoderCommand#progress
   * @param {Object} progress progress object
   * @param {Number} progress.frames number of frames transcoded
   * @param {Number} progress.currentFps current processing speed in frames per second
   * @param {Number} progress.currentKbps current output generation speed in kilobytes per second
   * @param {Number} progress.targetSize current output file size
   * @param {String} progress.timemark current video timemark
   * @param {Number} [progress.percent] processing progress (may not be available depending on input)
   */

  /**
   * Emitted when mencoder reports input codec data
   *
   * @event MencoderCommand#codecData
   * @param {Object} codecData codec data object
   * @param {String} codecData.format input format name
   * @param {String} codecData.audio input audio codec name
   * @param {String} codecData.audio_details input audio codec parameters
   * @param {String} codecData.video input video codec name
   * @param {String} codecData.video_details input video codec parameters
   */

  /**
   * Emitted when an error happens when preparing or running a command
   *
   * @event MencoderCommand#error
   * @param {Error} error error object
   * @param {String|null} stdout mencoder stdout, unless outputting to a stream
   * @param {String|null} stderr mencoder stderr
   */

  /**
   * Emitted when a command finishes processing
   *
   * @event MencoderCommand#end
   * @param {Array|null} [filenames] generated filenames when taking screenshots, null otherwise
   */


  /**
   * Spawn an mencoder process
   *
   * The 'options' argument may contain the following keys:
   * - 'niceness': specify process niceness, ignored on Windows (default: 0)
   * - 'captureStdout': capture stdout and pass it to 'endCB' as its 2nd argument (default: false)
   * - 'captureStderr': capture stderr and pass it to 'endCB' as its 3rd argument (default: false)
   *
   * The 'processCB' callback, if present, is called as soon as the process is created and
   * receives a nodejs ChildProcess object.  It may not be called at all if an error happens
   * before spawning the process.
   *
   * The 'endCB' callback is called either when an error occurs or when the mencoder process finishes.
   *
   * @method MencoderCommand#_spawnMencoder
   * @param {Array} args mencoder command line argument list
   * @param {Object} [options] spawn options (see above)
   * @param {Function} [processCB] callback called with process object when it has been created
   * @param {Function} endCB callback with signature (err, stdout, stderr)
   * @private
   */
  proto._spawnMencoder = function(args, options, processCB, endCB) {
    // Enable omitting options
    if (typeof options === 'function') {
      endCB = processCB;
      processCB = options;
      options = {};
    }

    // Enable omitting processCB
    if (typeof endCB === 'undefined') {
      endCB = processCB;
      processCB = function() {};
    }

    // Find mencoder
    this._getMencoderPath(function(err, command) {
      if (err) {
        return endCB(err);
      } else if (!command || command.length === 0) {
        return endCB(new Error('Cannot find mencoder'));
      }

      // Apply niceness
      if (options.niceness && options.niceness !== 0 && !utils.isWindows) {
        args.unshift('-n', options.niceness, command);
        command = 'nice';
      }

      var stdout = null;
      var stdoutClosed = false;

      var stderr = null;
      var stderrClosed = false;

      // Spawn process
      console.log("Spawn command mencoder with arguments: ");
      console.log(command + ' ' + args.join(' '));
      var mencoderProc = spawn(command, args, options);

      if (mencoderProc.stderr && options.captureStderr) {
        mencoderProc.stderr.setEncoding('utf8');
      }

      mencoderProc.on('error', function(err) {
        endCB(err);
      });

      // Ensure we wait for captured streams to end before calling endCB
      var exitError = null;
      function handleExit(err) {
        if (err) {
          exitError = err;
        }

        if (processExited &&
          (stdoutClosed || !options.captureStdout) &&
          (stderrClosed || !options.captureStderr)) {
          endCB(exitError, stdout, stderr);
        }
      }

      // Handle process exit
      var processExited = false;
      mencoderProc.on('exit', function(code, signal) {
        processExited = true;

        if (signal) {
          handleExit(new Error('mencoder was killed with signal ' + signal));
        } else if (code) {
          handleExit(new Error('mencoder exited with code ' + code));
        } else {
          handleExit();
        }
      });

      // Capture stdout if specified
      if (options.captureStdout) {
        stdout = '';

        mencoderProc.stdout.on('data', function(data) {
          stdout += data;
        });

        mencoderProc.stdout.on('close', function() {
          stdoutClosed = true;
          handleExit();
        });
      }

      // Capture stderr if specified
      if (options.captureStderr) {
        stderr = '';

        mencoderProc.stderr.on('data', function(data) {
          stderr += data;
        });

        mencoderProc.stderr.on('close', function() {
          stderrClosed = true;
          handleExit();
        });
      }

      // Call process callback
      processCB(mencoderProc);
    });
  };


  /**
   * Build the argument list for an mencoder command
   *
   * @method MencoderCommand#_getArguments
   * @return argument list
   * @private
   */
  proto._getArguments = function() {
    var complexFilters = this._complexFilters.get();

    return [].concat(
        // Inputs and input options
        this._inputs.reduce(function(args, input) {
          var source = (typeof input.source === 'string') ? input.source : 'pipe:0';

          // For each input, add input options, then '-i <source>'
          return args.concat(
            input.options.get(),
            ['mf://' + source]
          );
        }, []),

        // Global options
        this._global.get(),

        // Overwrite if we have file outputs
        //fileOutput ? ['-y'] : [],

        // Complex filters
        complexFilters,

        // Outputs, filters and output options
        this._outputs.reduce(function(args, output) {
          var sizeFilters = utils.makeFilterStrings(output.sizeFilters.get());
          var audioFilters = output.audioFilters.get();
          var videoFilters = output.videoFilters.get().concat(sizeFilters);
          var outputArg;

          if (!output.target) {
            outputArg = [];
          } else if (typeof output.target === 'string') {
            outputArg = ['-o',output.target];
          } else {
            outputArg = ['pipe:1'];
          }

          return args.concat(
            output.audio.get(),
            audioFilters.length ? ['-af', audioFilters.join(',')] : [],
            output.video.get(),
            videoFilters.length ? ['-vf', videoFilters.join(',')] : [],
            output.options.get(),
            outputArg
          );
        }, [])
      );
  };


  /**
   * Prepare execution of an mencoder command
   *
   * Checks prerequisites for the execution of the command (codec/format availability, flvtool...),
   * then builds the argument list for mencoder and pass them to 'callback'.
   *
   * @method MencoderCommand#_prepare
   * @param {Function} callback callback with signature (err, args)
   * @param {Boolean} [readMetadata=false] read metadata before processing
   * @private
   */
  proto._prepare = function(callback, readMetadata) {
    var self = this;

    async.waterfall([
      // Check codecs and formats
      //function(cb) {
        //self._checkCapabilities(cb);
      //},

      // Read metadata if required
      function(cb) {
        if (!readMetadata) {
          return cb();
        }

        self.ffprobe(0, function(err, data) {
          if (!err) {
            self._ffprobeData = data;
          }

          cb();
        });
      },

      // Check for flvtool2/flvmeta if necessary
      function(cb) {
        var flvmeta = self._outputs.some(function(output) {
          // Remove flvmeta flag on non-file output
          if (output.flags.flvmeta && !output.isFile) {
            self.logger.warn('Updating flv metadata is only supported for files');
            output.flags.flvmeta = false;
          }

          return output.flags.flvmeta;
        });

        if (flvmeta) {
          self._getFlvtoolPath(function(err) {
            cb(err);
          });
        } else {
          cb();
        }
      },

      // Build argument list
      function(cb) {
        var args;
        try {
          args = self._getArguments();
        } catch(e) {
          return cb(e);
        }

        cb(null, args);
      },

      // Add "-strict experimental" option where needed
      //function(args, cb) {
        //self.availableEncoders(function(err, encoders) {
          //for (var i = 0; i < args.length; i++) {
            //if (args[i] === '-acodec' || args[i] === '-vcodec') {
              //i++;

              //if ((args[i] in encoders) && encoders[args[i]].experimental) {
                //args.splice(i + 1, 0, '-strict', 'experimental');
                //i += 2;
              //}
            //}
          //}

          //cb(null, args);
        //});
      //}
    ], callback);

    if (!readMetadata) {
      // Read metadata as soon as 'progress' listeners are added

      if (this.listeners('progress').length > 0) {
        // Read metadata in parallel
        runFfprobe(this);
      } else {
        // Read metadata as soon as the first 'progress' listener is added
        this.once('newListener', function(event) {
          if (event === 'progress') {
            runFfprobe(this);
          }
        });
      }
    }
  };


  /**
   * Run mencoder command
   *
   * @method MencoderCommand#run
   * @category Processing
   * @aliases exec,execute
   */
  proto.exec =
  proto.execute =
  proto.run = function() {
    var self = this;

    // Check if at least one output is present
    var outputPresent = this._outputs.some(function(output) {
      return 'target' in output;
    });

    if (!outputPresent) {
      throw new Error('No output specified');
    }

    // Get output stream if any
    var outputStream = this._outputs.filter(function(output) {
      return typeof output.target !== 'string';
    })[0];

    // Get input stream if any
    var inputStream = this._inputs.filter(function(input) {
      return typeof input.source !== 'string';
    })[0];

    // Ensure we send 'end' or 'error' only once
    var ended = false;
    function emitEnd(err, stdout, stderr) {
      if (!ended) {
        ended = true;

        if (err) {
          self.emit('error', err, stdout, stderr);
        } else {
          self.emit('end', stdout, stderr);
        }
      }
    }

    self._prepare(function(err, args) {
      if (err) {
        return emitEnd(err);
      }

      // Run mencoder
      var stdout = null;
      var stderr = '';
      self._spawnMencoder(
        args,

        { niceness: self.options.niceness },

        function processCB(mencoderProc) {
          self.mencoderProc = mencoderProc;
          self.emit('start', 'mencoder ' + args.join(' '));

          // Pipe input stream if any
          if (inputStream) {
            inputStream.source.on('error', function(err) {
              emitEnd(new Error('Input stream error: ' + err.message));
              mencoderProc.kill();
            });

            inputStream.source.resume();
            inputStream.source.pipe(mencoderProc.stdin);

            // Set stdin error handler on mencoder (prevents nodejs catching the error, but
            // mencoder will fail anyway, so no need to actually handle anything)
            mencoderProc.stdin.on('error', function() {});
          }

          // Setup timeout if requested
          var processTimer;
          if (self.options.timeout) {
            processTimer = setTimeout(function() {
              var msg = 'process ran into a timeout (' + self.options.timeout + 's)';

              emitEnd(new Error(msg), stdout, stderr);
              mencoderProc.kill();
            }, self.options.timeout * 1000);
          }

          if (outputStream) {
            // Pipe mencoder stdout to output stream
            mencoderProc.stdout.pipe(outputStream.target, outputStream.pipeopts);

            // Handle output stream events
            outputStream.target.on('close', function() {
              self.logger.debug('Output stream closed, scheduling kill for ffmpgeg process');

              // Don't kill process yet, to give a chance to mencoder to
              // terminate successfully first  This is necessary because
              // under load, the process 'exit' event sometimes happens
              // after the output stream 'close' event.
              setTimeout(function() {
                emitEnd(new Error('Output stream closed'));
                mencoderProc.kill();
              }, 20);
            });

            outputStream.target.on('error', function(err) {
              self.logger.debug('Output stream error, killing mencoder process');
              emitEnd(new Error('Output stream error: ' + err.message));
              mencoderProc.kill();
            });
          } else {
            // Gather mencoder stdout
            stdout = '';
            mencoderProc.stdout.on('data', function (data) {
              stdout += data;
              console.log("=====" + data);
              if (self.listeners('progress').length) {
                var duration = 0;

                if (self._ffprobeData && self._ffprobeData.format && self._ffprobeData.format.duration) {
                  duration = Number(self._ffprobeData.format.duration);
                }

                utils.extractProgress(self, stdout, duration);
              }

            });
          }

          // Process mencoder stderr data
          self._codecDataSent = false;
          mencoderProc.stderr.on('data', function (data) {
            stderr += data;
            console.log("****** " + data);

            if (!self._codecDataSent && self.listeners('codecData').length) {
              utils.extractCodecData(self, stderr);
            }

          });
        },

        function endCB(err) {
          delete self.mencoderProc;

          if (err) {
            if (err.message.match(/mencoder exited with code/)) {
              // Add mencoder error message
              err.message += ': ' + utils.extractError(stderr);
            }

            emitEnd(err, stdout, stderr);
          } else {
            // Find out which outputs need flv metadata
            var flvmeta = self._outputs.filter(function(output) {
              return output.flags.flvmeta;
            });

            if (flvmeta.length) {
              self._getFlvtoolPath(function(err, flvtool) {
                // No possible error here, getFlvtoolPath was already called by _prepare
                async.each(
                  flvmeta,
                  function(output, cb) {
                    spawn(flvtool, ['-U', output.target])
                      .on('error', function(err) {
                        cb(new Error('Error running ' + flvtool + ' on ' + output.target + ': ' + err.message));
                      })
                      .on('exit', function(code, signal) {
                        if (code !== 0 || signal) {
                          cb(
                            new Error(flvtool + ' ' +
                              (signal ? 'received signal ' + signal
                                      : 'exited with code ' + code)) +
                              ' when running on ' + output.target
                          );
                        } else {
                          cb();
                        }
                      });
                  },
                  function(err) {
                    if (err) {
                      emitEnd(err);
                    } else {
                      emitEnd(null, stdout, stderr);
                    }
                  }
                );
              });
            } else {
              emitEnd(null, stdout, stderr);
            }
          }
        }
      );
    });
  };


  /**
   * Renice current and/or future mencoder processes
   *
   * Ignored on Windows platforms.
   *
   * @method MencoderCommand#renice
   * @category Processing
   *
   * @param {Number} [niceness=0] niceness value between -20 (highest priority) and 20 (lowest priority)
   * @return MencoderCommand
   */
  proto.renice = function(niceness) {
    if (!utils.isWindows) {
      niceness = niceness || 0;

      if (niceness < -20 || niceness > 20) {
        this.logger.warn('Invalid niceness value: ' + niceness + ', must be between -20 and 20');
      }

      niceness = Math.min(20, Math.max(-20, niceness));
      this.options.niceness = niceness;

      if (this.mencoderProc) {
        var logger = this.logger;
        var pid = this.mencoderProc.pid;
        var renice = spawn('renice', [niceness, '-p', pid]);

        renice.on('error', function(err) {
          logger.warn('could not renice process ' + pid + ': ' + err.message);
        });

        renice.on('exit', function(code, signal) {
          if (signal) {
            logger.warn('could not renice process ' + pid + ': renice was killed by signal ' + signal);
          } else if (code) {
            logger.warn('could not renice process ' + pid + ': renice exited with ' + code);
          } else {
            logger.info('successfully reniced process ' + pid + ' to ' + niceness + ' niceness');
          }
        });
      }
    }

    return this;
  };


  /**
   * Kill current mencoder process, if any
   *
   * @method MencoderCommand#kill
   * @category Processing
   *
   * @param {String} [signal=SIGKILL] signal name
   * @return MencoderCommand
   */
  proto.kill = function(signal) {
    if (!this.mencoderProc) {
      this.logger.warn('No running mencoder process, cannot send signal');
    } else {
      this.mencoderProc.kill(signal || 'SIGKILL');
    }

    return this;
  };
};
