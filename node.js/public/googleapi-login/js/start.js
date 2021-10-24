'use strict';

//const vConsole = new VConsole();
//window.datgui = new dat.GUI();

const CLIENT_ID = '【クライアントID】';
const REDIRECT_URI = 'https://【Node.jsサーバのホスト名】/googleapi-login';

var vue_options = {
    el: "#top",
    mixins: [mixins_bootstrap],
    data: {
        message: ''
    },
    computed: {
    },
    methods: {
        do_login: function () {
            var params = {
                scope: decodeURI(searchs.scope),
                response_type: 'code',
                client_id: CLIENT_ID,
                redirect_uri: REDIRECT_URI,
                access_type: 'offline',
                prompt: 'consent'
            };
            if( searchs.state )
                params.state = searchs.state;
            window.location = 'https://accounts.google.com/o/oauth2/v2/auth' + '?' + new URLSearchParams(params).toString();
        }
    },
    created: function(){
    },
    mounted: function(){
        proc_load();

        if( searchs.code && searchs.scope ){
            var qs = {
                code: searchs.code,
                scope: searchs.scope,
                redirect_uri: REDIRECT_URI,
                state: searchs.state
            };
            window.opener.vue.do_token(qs);
            window.close();
        }else if( searchs.scope ){
            this.do_login();
        }else{
            this.message = 'scope が指定されていません。'
        }
    }
};
vue_add_data(vue_options, { progress_title: '' }); // for progress-dialog
vue_add_global_components(components_bootstrap);
vue_add_global_components(components_utils);

/* add additional components */
  
window.vue = new Vue( vue_options );
