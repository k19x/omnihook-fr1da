Java.perform(function() {
    console.log("[*] Iniciando Hook Universal de Requisições (OkHttp3)...");

    try {
        // Tenta encontrar a classe do OkHttp3 Builder
        // Em apps ofuscados, pode ser necessário achar o nome da classe 'a.b.c' real
        var RequestBuilder = Java.use("okhttp3.Request$Builder");

        RequestBuilder.build.overload().implementation = function() {
            var request = this.build();
            
            var url = request.url().toString();
            var method = request.method();
            var headers = request.headers().toString();

            console.log("\n[+] Requisição Capturada:");
            console.log("    URL: " + url);
            console.log("    Method: " + method);
            // Descomente abaixo se quiser ver os headers (gera muito texto)
            // console.log("    Headers: " + headers);

            return request;
        };
    } catch (e) {
        console.log("[-] Erro: Biblioteca OkHttp3 não encontrada ou ofuscada. O app pode estar usando HttpUrlConnection ou código nativo.");
    }
    
    // Hook para java.net.URL (Apps mais antigos ou simples)
    try {
        var URL = Java.use("java.net.URL");
        URL.$init.overload('java.lang.String').implementation = function(str) {
            console.log("[+] java.net.URL: " + str);
            return this.$init(str);
        };
    } catch(e) { }
});