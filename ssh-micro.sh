#!/usr/bin/expect -f
set timeout 60
set password "gn%!CTvZNP0e4%Lc"
set host "root@106.52.176.246"
set cmd [lindex $argv 0]

spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 $host $cmd
expect {
    "password:" { send "$password\r" }
    "Password:" { send "$password\r" }
    timeout { puts "TIMEOUT"; exit 1 }
    eof { }
}
expect {
    "password:" { send "$password\r"; exp_continue }
    "Password:" { send "$password\r"; exp_continue }
    eof { }
}
catch wait result
exit [lindex $result 3]
