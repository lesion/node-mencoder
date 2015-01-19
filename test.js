var anon = require('./mencoder.js');
var b = new anon();
b.videoCodec('x264');
b.addInput('/home/lesion/Pictures/fuori2/*');
b.save('ciao.avi');




