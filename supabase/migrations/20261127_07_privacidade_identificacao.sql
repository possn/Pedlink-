-- Acrescenta aos termos o circuito de identificação do doente pelo código do caso.
update public.conteudos
   set corpo = corpo || '

10. Identificação do doente (circuito do código)
• Cada caso recebe um código sequencial (PL-AAAA-NNNN). A app nunca guarda a identificação do doente.
• O MGF regista o código no processo clínico oficial do doente (SClínico/MIM@UF), onde a identificação já existe legalmente.
• Quando há referenciação, esta segue o circuito formal (CTH), com o código PedLink no texto do pedido.
• Se a Pediatria precisar de identificar o doente antes, o nº de utente é enviado por email institucional (@…min-saude.pt) com o código, fora da app.
• O médico de família e o hospital pertencem à mesma ULS (responsável pelo tratamento único); a troca de identificação ocorre apenas nos sistemas institucionais.',
       updated_at = now()
 where chave = 'privacidade'
   and corpo not like '%Identificação do doente (circuito do código)%';
