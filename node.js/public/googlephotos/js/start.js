'use strict';

//const vConsole = new VConsole();
//window.datgui = new dat.GUI();

var new_win;
const SCOPE = 'https://www.googleapis.com/auth/photoslibrary https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/tasks.readonly';

const login_url = 'https://【Node.jsサーバのホスト名】/googleapi-login';
const googlephotos_base_url = '【Node.jsサーバのホスト名】';

var vue_options = {
    el: "#top",
    mixins: [mixins_bootstrap],
    data: {
        state: Math.random().toString(32).substring(2),
        album_list: [],
        sharedalbum_list: [],
        sharedalbum_check: [],
        username: null,
        image_data: null,
        access_type_offline: false,
        input_date: "",
        event_list: []
    },
    computed: {
    },
    methods: {
        update_image: async function(){
            var blob = await do_get_blob(googlephotos_base_url + '/googlephotos-image');
            this.image_data = URL.createObjectURL(blob);
        },
        do_login: function () {
            var params = {
                scope: SCOPE,
                state: this.state,
                access_type: this.access_type_offline
            };
            new_win = open(login_url + '?' + new URLSearchParams(params).toString(), null, 'width=480,height=750');
        },
        do_token: async function(qs){
            console.log(qs);
            if( qs.state != this.state ){
                alert('state mismatch');
                return;
            }

            var param = {
                code: qs.code,
                redirect_uri: qs.redirect_uri
            };
            var result = await do_post(googlephotos_base_url + '/googlephotos-account-create', param);
            console.log(result);
            this.get_albumlist();
            this.get_username();
        },
        get_username: async function(){
            var result = await do_post(googlephotos_base_url + '/googlephotos-get-username');
            console.log(result);
            this.username = result.name;
        },
        get_albumlist: async function(){
            var result = await do_post(googlephotos_base_url + '/googlephotos-get-albumlist' );
            console.log(result);
            var result2 = await do_post(googlephotos_base_url + '/googlephotos-get-sharedalbum');
            console.log(result2);
            var list = [];
            result.list.map(item =>{
                var album = result2.list.find(item2 => item2.id == item );
                if( album )
                    list.push(album)
            });
            this.album_list = list;
        },
        call_albumlist_change: async function(){
            try{
              this.progress_open();
              var result = await do_post(googlephotos_base_url + '/googlephotos-get-sharedalbum');
              this.sharedalbum_list = result.list;
              this.sharedalbum_check = [];
              for (var i = 0; i < this.sharedalbum_list.length ; i++ ){
                  if (this.album_list.findIndex(item => item.id == this.sharedalbum_list[i].id ) >= 0 )
                      this.sharedalbum_check[i] = true;
                  else
                      this.sharedalbum_check[i] = false;
              }
            }catch(error){
              console.error(error);
              return;
            }finally{
              this.progress_close();
            }
            this.dialog_open('#albumlist_change_dialog');
        },
        do_albumlist_change: async function(){
            var list = [];
            for( var i = 0 ; i < this.sharedalbum_list.length ; i++ ){
                if( this.sharedalbum_check[i] )
                    list.push( this.sharedalbum_list[i].id );
            }

            await do_post(googlephotos_base_url + '/googlephotos-update-albumlist', { list: list });
            this.get_albumlist();
            this.dialog_close('#albumlist_change_dialog');
        },
        sync_instagram: async function(){
            try{
                this.progress_open();
                var result = await do_post(googlephotos_base_url + '/googlephotos-sync-instagram');
                alert( String(result.num) + '個の画像を取り込みました。' );
            }finally{
                this.progress_close();
            }
        },
        date_change: async function(){
            var date = new Date(this.input_date);
            date.setHours(date.getHours() - 9);
            var params = {
                date: date.getTime()
            };
            var result = await do_post(googlephotos_base_url + '/googlecalendar-list', params);
            console.log(result);
            this.event_list = result.list;
        },
        calendar_register: async function(){
            try{
                await do_post(googlephotos_base_url + '/googlecalendar-register-webhooks');
                alert("登録しました。");
            }catch(error){
                console.error(error);
                alert(error);
            }
        },
        calendar_unregister: async function(){
            try {
                await do_post(googlephotos_base_url + '/googlecalendar-unregister-webhooks');
                alert("解除しました。");
            } catch (error) {
                console.error(error);
                alert(error);
            }
        }
    },
    created: function(){
    },
    mounted: async function(){
        proc_load();

        try{
            await this.get_albumlist();
            await this.get_username();
        }finally{
            loader_loaded();
        }
    }
};
vue_add_data(vue_options, { progress_title: '' }); // for progress-dialog
vue_add_global_components(components_bootstrap);
vue_add_global_components(components_utils);

/* add additional components */
  
window.vue = new Vue( vue_options );

function do_get_blob(url, qs) {
    const params = new URLSearchParams(qs);

    return fetch(params.toString() ? url + `?` + params.toString() : url, {
        method: 'GET',
    })
        .then((response) => {
            if (!response.ok)
                throw 'status is not 200';
//            return response.json();
            //    return response.text();
            return response.blob();
            //    return response.arrayBuffer();
        });
}